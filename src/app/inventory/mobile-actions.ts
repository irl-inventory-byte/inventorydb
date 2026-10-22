"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MOBILE_ADD_ROLES } from "@/lib/access";
import { planAddItem } from "@/lib/add-item";
import { requireRole } from "@/lib/authz";
import {
  findMobile,
  imeisIn,
  loadMobileSheet,
  mobileAttributes,
  mobileSheetError,
  type MobileRecord,
  type MobileSheetInfo,
} from "@/lib/mobile-sheet";
import { MOBILE_HUB_NAME, mobileHomeHub } from "@/lib/rig-hub";
import type { Item, ItemEvent } from "@/lib/schema";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;
const NO_HUB = `No active hub named "${MOBILE_HUB_NAME}". Add it on the Hubs page first.`;
const MOBILE_BULK_LIMIT = 200;

export type MobileLookup = {
  imei: string;
  assetTag: string;
  serial: string;
  model: string;
  modelNo: string;
  category: string;
  manufacturer: string;
  storage: string;
  cost: string;
};

const toLookup = (r: MobileRecord): MobileLookup => ({
  imei: r.imei,
  assetTag: r.assetTag,
  serial: r.serial,
  model: r.model,
  modelNo: r.modelNo,
  category: r.category,
  manufacturer: r.manufacturer,
  storage: r.storage,
  cost: r.cost,
});

/** Why a phone was not found, in plain words, with what was read from the sheet. */
function notFoundText(scanned: string, info: MobileSheetInfo): string {
  const imeis = imeisIn(scanned);
  const what = imeis.length ? `IMEI ${imeis.join(" / ")}` : `"${scanned.slice(0, 40)}"`;
  return (
    `${what} is not in the mobile sheet (checked IMEI, Asset Tag and Serial of ${info.phones} phones in the tab "${info.tab}"). ` +
    `Enter the details by hand, or check the sheet.`
  );
}

/**
 * Look a phone up in the mobile sheet by the scanned IMEI.
 * { notFound } = not in the sheet; { error } = the sheet could not be read. Both in plain words.
 */
export async function lookupMobile(
  scanned: string,
): Promise<MobileLookup | { error: string } | { notFound: string }> {
  await requireRole(...MOBILE_ADD_ROLES);
  let sheet;
  try {
    sheet = await loadMobileSheet();
  } catch (error) {
    console.error("Mobile sheet lookup failed:", error);
    return { error: mobileSheetError(error) };
  }
  const r = findMobile(sheet.records, scanned);
  return r ? toLookup(r) : { notFound: notFoundText(scanned, sheet.info) };
}

function refresh() {
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/handover/receipts");
}

/** Add one mobile: Admin and IM. Home hub Instawork Robotics Labs, in stock. */
export async function addMobile(formData: FormData) {
  const user = await requireRole(...MOBILE_ADD_ROLES);
  const reject = (message: string): never =>
    redirect(`/inventory?${new URLSearchParams({ type: "mobile", addError: message })}`);

  const text = (name: string) => String(formData.get(name) ?? "").trim();
  // The one required box: a QR code, IMEI, Asset Tag or Serial.
  const find = text("find");
  if (!find) reject("Scan the QR code, or type the IMEI, Asset Tag or Serial.");
  const typed = [...imeisIn(find), ...imeisIn(text("imei"))];

  // The sheet is read again on the server; what it says wins over the form.
  let found: MobileRecord | undefined;
  try {
    found = findMobile((await loadMobileSheet()).records, find);
  } catch {
    found = undefined;
  }
  if (!found && typed.length === 0) {
    reject(`"${find.slice(0, 40)}" is not in the mobile sheet. To add it by hand, also fill in its IMEI (15 digits).`);
  }
  const imei = found?.imei ?? typed[0];
  const all = found?.imeis ?? typed;

  const store = getStore();
  const [items, hubs] = await Promise.all([store.list("items"), store.list("hubs")]);
  const homeHub = mobileHomeHub(hubs)?.hub_id ?? "";
  if (!homeHub) reject(NO_HUB);

  // The same phone may have two IMEIs: refuse it if either one is already saved.
  const saved = new Set(items.map((i) => i.item_id));
  const already = all.find((i) => saved.has(i));
  if (already) reject(`This mobile (IMEI ${already}) is already in the inventory.`);

  const field = (name: string, fromSheet?: string) => (fromSheet || text(name)).trim();
  const cost = (found?.cost || text("cost")).replace(/[^0-9]/g, "");

  const plan = planAddItem(
    {
      itemId: imei,
      homeHub,
      prismNo: "",
      brand: field("manufacturer", found?.manufacturer),
      model: field("model", found?.model),
      price: cost,
      itemType: "mobile",
      attributes: mobileAttributes({
        assetTag: field("assetTag", found?.assetTag),
        serial: field("serial", found?.serial),
        modelNo: field("modelNo", found?.modelNo),
        category: field("category", found?.category),
        storage: field("storage", found?.storage),
      }),
    },
    items,
    { hubs, by: user.email ?? "unknown", now: istTimestamp(), newId },
  );
  if (plan.errors.length || !plan.item || !plan.event) {
    reject(plan.errors.join(" ") || "The mobile could not be prepared. Nothing was saved.");
  }
  plan.event!.note = "Mobile added to inventory";

  await store.commitBatch([plan.event!], [plan.item!]);
  refresh();
  redirect(`/inventory?${new URLSearchParams({ type: "mobile", added: plan.item!.item_id })}`);
}

/* ------------------------------------------------------------------ */
/* ADD MANY MOBILES: Admin and IM                                       */
/* ------------------------------------------------------------------ */

export type MobileCheck = MobileLookup & {
  scanned: string;
  status: "ready" | "exists" | "repeated" | "notfound" | "noimei";
};

/** Check a list of scans before saving: found in the sheet, already added, repeated. */
export async function checkMobiles(scans: string[]): Promise<{ rows: MobileCheck[]; error?: string; info?: string }> {
  await requireRole(...MOBILE_ADD_ROLES);
  let sheet;
  try {
    sheet = await loadMobileSheet();
  } catch (error) {
    return { rows: [], error: mobileSheetError(error) };
  }
  const saved = new Set((await getStore().list("items")).map((i) => i.item_id));
  const seen = new Set<string>();
  const rows: MobileCheck[] = [];
  const empty = { imei: "", assetTag: "", serial: "", model: "", modelNo: "", category: "", manufacturer: "", storage: "", cost: "" };

  for (const raw of scans.slice(0, MOBILE_BULK_LIMIT)) {
    const scanned = String(raw ?? "").trim();
    if (!scanned) continue;
    const found = findMobile(sheet.records, scanned);
    const base = found ? toLookup(found) : { ...empty, imei: imeisIn(scanned)[0] ?? "" };
    const ids = found?.imeis ?? imeisIn(scanned);
    let status: MobileCheck["status"] = "ready";
    if (!ids.length) status = found ? "noimei" : "notfound";
    else if (ids.some((i) => seen.has(i))) status = "repeated";
    else if (ids.some((i) => saved.has(i))) status = "exists";
    else if (!found) status = "notfound";
    ids.forEach((i) => seen.add(i));
    rows.push({ ...base, scanned, status });
  }
  const info = `Read ${sheet.info.phones} phones from the tab "${sheet.info.tab}".`;
  return { rows, info };
}

export type MobileBulkResult = { added: string[]; skipped: { imei: string; reason: string }[]; error?: string };

/**
 * Add many mobiles at once, all at Instawork Robotics Labs, in stock. Details come from the mobile sheet
 * (read again here, not taken from the browser); phones not in the sheet are skipped. One receipt for all.
 */
export async function addMobiles(scans: string[]): Promise<MobileBulkResult> {
  const user = await requireRole(...MOBILE_ADD_ROLES);
  const list = (scans ?? []).map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, MOBILE_BULK_LIMIT);
  if (!list.length) return { added: [], skipped: [], error: "There are no mobiles to add." };

  let records: MobileRecord[];
  try {
    records = (await loadMobileSheet()).records;
  } catch (error) {
    return { added: [], skipped: [], error: mobileSheetError(error) };
  }

  const store = getStore();
  const [items, hubs] = await Promise.all([store.list("items"), store.list("hubs")]);
  const homeHub = mobileHomeHub(hubs)?.hub_id ?? "";
  if (!homeHub) return { added: [], skipped: [], error: NO_HUB };

  const known: Item[] = [...items];
  const events: ItemEvent[] = [];
  const toSave: Item[] = [];
  const skipped: MobileBulkResult["skipped"] = [];
  const now = istTimestamp();
  const batch = newId("b"); // one receipt for the whole list

  for (const scanned of list) {
    const found = findMobile(records, scanned);
    const label = found?.imei ?? imeisIn(scanned)[0] ?? scanned;
    if (!found) {
      skipped.push({ imei: label, reason: "not in the mobile sheet" });
      continue;
    }
    const taken = new Set(known.map((i) => i.item_id));
    if (found.imeis.some((i) => taken.has(i))) {
      skipped.push({ imei: label, reason: "already in the inventory" });
      continue;
    }
    const plan = planAddItem(
      {
        itemId: found.imei,
        homeHub,
        prismNo: "",
        brand: found.manufacturer,
        model: found.model,
        price: found.cost,
        itemType: "mobile",
        attributes: mobileAttributes(found),
      },
      known,
      { hubs, by: user.email ?? "unknown", now, newId },
    );
    if (plan.errors.length || !plan.item || !plan.event) {
      skipped.push({ imei: label, reason: plan.errors.join(" ") || "could not be prepared" });
      continue;
    }
    plan.event.batch_id = batch;
    plan.event.note = "Mobile added to inventory";
    known.push(plan.item);
    events.push(plan.event);
    toSave.push(plan.item);
  }

  if (!toSave.length) return { added: [], skipped };
  await store.commitBatch(events, toSave);
  refresh();
  return { added: toSave.map((i) => i.item_id), skipped };
}
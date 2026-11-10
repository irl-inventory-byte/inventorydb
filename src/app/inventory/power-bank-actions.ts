"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { POWER_BANK_ADD_ROLES } from "@/lib/access";
import { planAddItem } from "@/lib/add-item";
import { requireRole } from "@/lib/authz";
import {
  findPowerBank,
  loadPowerBankSheet,
  powerBankAttributes,
  powerBankSheetError,
  type PowerBankRecord,
  type PowerBankSheetInfo,
} from "@/lib/power-bank-sheet";
import type { Item, ItemEvent } from "@/lib/schema";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

export type PowerBankLookup = {
  assetTag: string;
  date: string;
  type: string;
  brand: string;
  model: string;
  color: string;
  capacity: string;
  output: string;
  price: string;
};

const toLookup = (r: PowerBankRecord): PowerBankLookup => ({
  assetTag: r.assetTag,
  date: r.date,
  type: r.type,
  brand: r.brand,
  model: r.model,
  color: r.color,
  capacity: r.capacity,
  output: r.output,
  price: r.price,
});

/** Why a power bank was not found, in plain words, with what was read from the sheet. */
function notFoundText(scanned: string, info: PowerBankSheetInfo): string {
  return (
    `"${scanned.slice(0, 40)}" is not in the power bank sheet (checked ${info.powerBanks} power banks in the tab "${info.tab}"). ` +
    `Enter the details by hand, or check the sheet.`
  );
}

/**
 * Look a power bank up in the power bank sheet by its scanned/typed Asset Tag.
 * { notFound } = not in the sheet; { error } = the sheet could not be read. Both in plain words.
 */
export async function lookupPowerBank(
  scanned: string,
): Promise<PowerBankLookup | { error: string } | { notFound: string }> {
  await requireRole(...POWER_BANK_ADD_ROLES);
  let sheet;
  try {
    sheet = await loadPowerBankSheet();
  } catch (error) {
    console.error("Power bank sheet lookup failed:", error);
    return { error: powerBankSheetError(error) };
  }
  const r = findPowerBank(sheet.records, scanned);
  return r ? toLookup(r) : { notFound: notFoundText(scanned, sheet.info) };
}

function refresh() {
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/handover/receipts");
}

/**
 * Add one power bank: Admin and IM. Asset Tag is looked up in the power bank sheet (read again here, not
 * taken from the browser) — the sheet's Date, Brand, Model, Color, Capacity, Output and Price/Penalty win
 * over anything typed in the form. Not in the sheet: the typed details are saved instead.
 */
export async function addPowerBank(formData: FormData) {
  const user = await requireRole(...POWER_BANK_ADD_ROLES);

  const reject = (message: string): never =>
    redirect(`/inventory?${new URLSearchParams({ type: "power_bank", addError: message })}`);

  const text = (name: string) => String(formData.get(name) ?? "").trim();

  const itemId = text("itemId") || text("find");
  const homeHub = text("homeHub");
  if (!itemId) reject("Enter or scan the Asset Tag.");
  if (!homeHub) reject("Select the home hub.");

  // The sheet is read again on the server; what it says wins over the form.
  let found: PowerBankRecord | undefined;
  try {
    found = findPowerBank((await loadPowerBankSheet()).records, itemId);
  } catch {
    found = undefined;
  }

  const store = getStore();
  const [items, hubs] = await Promise.all([store.list("items"), store.list("hubs")]);

  if (!hubs.some((h) => h.hub_id === homeHub && h.active !== "false")) {
    reject("Please select a valid active home hub.");
  }

  const saved = new Set(items.map((i) => i.item_id));
  if (saved.has(itemId)) reject(`This power bank (${itemId}) is already in the inventory.`);

  const field = (name: string, fromSheet?: string) => (fromSheet || text(name)).trim();
  const price = (found?.price || text("price")).replace(/[^0-9]/g, "");

  const plan = planAddItem(
    {
      itemId,
      homeHub,
      prismNo: "",
      brand: field("brand", found?.brand),
      model: field("model", found?.model),
      price,
      itemType: "power_bank",
      attributes: powerBankAttributes({
        color: field("color", found?.color),
        capacity: field("capacity", found?.capacity),
        output: field("output", found?.output),
        date: field("date", found?.date),
      }),
    },
    items,
    { hubs, by: user.email ?? "unknown", now: istTimestamp(), newId },
  );
  if (plan.errors.length || !plan.item || !plan.event) {
    reject(plan.errors.join(" ") || "The power bank could not be prepared. Nothing was saved.");
  }
  plan.event!.note = "Power bank added to inventory";

  await store.commitBatch([plan.event!], [plan.item!]);
  refresh();
  redirect(`/inventory?${new URLSearchParams({ type: "power_bank", added: plan.item!.item_id })}`);
}

/* ------------------------------------------------------------------ */
/* ADD MANY POWER BANKS: Admin and IM                                   */
/* ------------------------------------------------------------------ */

const POWER_BANK_BULK_LIMIT = 200;

export type PowerBankCheck = PowerBankLookup & {
  scanned: string;
  status: "ready" | "exists" | "repeated" | "notfound";
};

const emptyLookup: PowerBankLookup = {
  assetTag: "",
  date: "",
  type: "Power Bank",
  brand: "",
  model: "",
  color: "",
  capacity: "",
  output: "",
  price: "",
};

/** Check a list of Asset Tags before saving: found in the sheet, already added, repeated. */
export async function checkPowerBanks(scans: string[]): Promise<{ rows: PowerBankCheck[]; error?: string; info?: string }> {
  await requireRole(...POWER_BANK_ADD_ROLES);
  let sheet;
  try {
    sheet = await loadPowerBankSheet();
  } catch (error) {
    return { rows: [], error: powerBankSheetError(error) };
  }
  const saved = new Set((await getStore().list("items")).map((i) => i.item_id));
  const seen = new Set<string>();
  const rows: PowerBankCheck[] = [];

  for (const raw of scans.slice(0, POWER_BANK_BULK_LIMIT)) {
    const scanned = String(raw ?? "").trim();
    if (!scanned) continue;
    const found = findPowerBank(sheet.records, scanned);
    const base = found ? toLookup(found) : { ...emptyLookup, assetTag: scanned };
    const id = found?.assetTag ?? scanned;
    const key = id.toLowerCase();
    let status: PowerBankCheck["status"] = "ready";
    if (!found) status = "notfound";
    else if (seen.has(key)) status = "repeated";
    else if (saved.has(id)) status = "exists";
    seen.add(key);
    rows.push({ ...base, scanned, status });
  }
  const info = `Read ${sheet.info.powerBanks} power banks from the tab "${sheet.info.tab}".`;
  return { rows, info };
}

export type PowerBankBulkResult = { added: string[]; skipped: { assetTag: string; reason: string }[]; error?: string };

/**
 * Add many power banks at once, all at the chosen home hub, in stock. Details come from the power bank
 * sheet (read again here, not taken from the browser); Asset Tags not in the sheet are skipped. One
 * receipt for all.
 */
export async function addPowerBanks(scans: string[], homeHub: string): Promise<PowerBankBulkResult> {
  const user = await requireRole(...POWER_BANK_ADD_ROLES);
  const list = (scans ?? []).map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, POWER_BANK_BULK_LIMIT);
  if (!list.length) return { added: [], skipped: [], error: "There are no power banks to add." };
  if (!homeHub) return { added: [], skipped: [], error: "Select the home hub." };

  let records: PowerBankRecord[];
  try {
    records = (await loadPowerBankSheet()).records;
  } catch (error) {
    return { added: [], skipped: [], error: powerBankSheetError(error) };
  }

  const store = getStore();
  const [items, hubs] = await Promise.all([store.list("items"), store.list("hubs")]);
  if (!hubs.some((h) => h.hub_id === homeHub && h.active !== "false")) {
    return { added: [], skipped: [], error: "Please select a valid active home hub." };
  }

  const known: Item[] = [...items];
  const events: ItemEvent[] = [];
  const toSave: Item[] = [];
  const skipped: PowerBankBulkResult["skipped"] = [];
  const now = istTimestamp();
  const batch = newId("b"); // one receipt for the whole list
  const by = user.email ?? "unknown";
  const taken = new Set(known.map((i) => i.item_id));

  for (const scanned of list) {
    const found = findPowerBank(records, scanned);
    const assetTag = found?.assetTag ?? scanned;
    if (!found) {
      skipped.push({ assetTag, reason: "not in the power bank sheet" });
      continue;
    }
    if (taken.has(assetTag)) {
      skipped.push({ assetTag, reason: "already in the inventory" });
      continue;
    }
    const plan = planAddItem(
      {
        itemId: assetTag,
        homeHub,
        prismNo: "",
        brand: found.brand,
        model: found.model,
        price: found.price,
        itemType: "power_bank",
        attributes: powerBankAttributes({ color: found.color, capacity: found.capacity, output: found.output, date: found.date }),
      },
      known,
      { hubs, by, now, newId },
    );
    if (plan.errors.length || !plan.item || !plan.event) {
      skipped.push({ assetTag, reason: plan.errors.join(" ") || "could not be prepared" });
      continue;
    }
    plan.event.batch_id = batch;
    plan.event.note = "Power bank added to inventory";
    taken.add(assetTag);
    known.push(plan.item);
    events.push(plan.event);
    toSave.push(plan.item);
  }

  if (!toSave.length) return { added: [], skipped };
  await store.commitBatch(events, toSave);
  refresh();
  return { added: toSave.map((i) => i.item_id), skipped };
}
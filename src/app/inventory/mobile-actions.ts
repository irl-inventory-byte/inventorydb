"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { MOBILE_ADD_ROLES } from "@/lib/access";
import { planAddItem } from "@/lib/add-item";
import { requireRole } from "@/lib/authz";
import { findMobile, imeisIn, loadMobileRecords, mobileAttributes, mobileSheetError } from "@/lib/mobile-sheet";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

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

/**
 * Look a phone up in the mobile sheet by the scanned IMEI. null = not found.
 * { error } = the sheet could not be read, with the reason in plain words.
 */
export async function lookupMobile(scanned: string): Promise<MobileLookup | { error: string } | null> {
  await requireRole(...MOBILE_ADD_ROLES);
  let records;
  try {
    records = await loadMobileRecords();
  } catch (error) {
    console.error("Mobile sheet lookup failed:", error);
    return { error: mobileSheetError(error) };
  }
  const r = findMobile(records, scanned);
  if (!r) return null;
  return {
    imei: r.imei,
    assetTag: r.assetTag,
    serial: r.serial,
    model: r.model,
    modelNo: r.modelNo,
    category: r.category,
    manufacturer: r.manufacturer,
    storage: r.storage,
    cost: r.cost,
  };
}

/** Add a mobile: Admin and IM. It starts in stock at the chosen hub. Mobiles are not sent or received. */
export async function addMobile(formData: FormData) {
  const user = await requireRole(...MOBILE_ADD_ROLES);
  const reject = (message: string): never =>
    redirect(`/inventory?${new URLSearchParams({ type: "mobile", addError: message })}`);

  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const scanned = text("imei");
  const typed = imeisIn(scanned);
  if (typed.length === 0) reject("Scan or type the IMEI (15 digits).");

  // The sheet is read again on the server; what it says wins over the form.
  let found;
  try {
    found = findMobile(await loadMobileRecords(), scanned);
  } catch {
    found = undefined;
  }
  const imei = found?.imei ?? typed[0];
  const all = found?.imeis ?? typed;

  const store = getStore();
  const [items, hubs] = await Promise.all([store.list("items"), store.list("hubs")]);

  // The same phone may have two IMEIs: refuse it if either one is already saved.
  const saved = new Set(items.map((i) => i.item_id));
  const already = all.find((i) => saved.has(i));
  if (already) reject(`This mobile (IMEI ${already}) is already in the inventory.`);

  const field = (name: string, fromSheet?: string) => (fromSheet || text(name)).trim();
  const cost = (found?.cost || text("cost")).replace(/[^0-9]/g, "");

  const plan = planAddItem(
    {
      itemId: imei,
      homeHub: text("homeHub"),
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

  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  redirect(`/inventory?${new URLSearchParams({ type: "mobile", added: plan.item!.item_id })}`);
}
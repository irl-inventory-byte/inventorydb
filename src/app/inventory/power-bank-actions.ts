"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { POWER_BANK_ADD_ROLES } from "@/lib/access";
import { planAddItem } from "@/lib/add-item";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

function refresh() {
  revalidatePath("/inventory");
  revalidatePath("/dashboard");
  revalidatePath("/handover/receipts");
}

/**
 * Add one power bank: Admin and IM, by hand (no reference sheet). Asset Tag is the item's serial; the
 * rest (Brand, Model, Color, Capacity, Output) are saved as attributes, and the Price/Penalty amount is
 * saved on the item like a card's penalty.
 */
export async function addPowerBank(formData: FormData) {
  const user = await requireRole(...POWER_BANK_ADD_ROLES);

  const reject = (message: string): never =>
    redirect(`/inventory?${new URLSearchParams({ type: "power_bank", addError: message })}`);

  const text = (name: string) => String(formData.get(name) ?? "").trim();

  const itemId = text("itemId");
  const homeHub = text("homeHub");
  const brand = text("brand");
  const model = text("model");
  const color = text("color");
  const capacity = text("capacity");
  const output = text("output");
  const price = text("price").replace(/[^0-9]/g, "");

  if (!itemId) reject("Enter the Asset Tag.");

  const store = getStore();
  const [items, hubs] = await Promise.all([store.list("items"), store.list("hubs")]);

  if (!homeHub) reject("Select the home hub.");
  if (!hubs.some((h) => h.hub_id === homeHub && h.active !== "false")) {
    reject("Please select a valid active home hub.");
  }

  const plan = planAddItem(
    {
      itemId,
      homeHub,
      prismNo: "",
      brand,
      model,
      price,
      itemType: "power_bank",
      attributes: JSON.stringify({ color, capacity, output }),
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
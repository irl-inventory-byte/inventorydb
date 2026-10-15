"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  HARDWARE_ROLES,
  QC_ROLES,
  canSeeType,
  itemType,
} from "@/lib/access";
import { planAddItem } from "@/lib/add-item";
import { requireRole } from "@/lib/authz";
import { rigHomeHub } from "@/lib/rig-hub";
import { findRig, loadRigRecords, rigSheetError } from "@/lib/rig-sheet";
import { QC_STATUSES, type QcStatus } from "@/lib/schema";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

const newId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

function refresh(itemId?: string) {
  revalidatePath("/inventory");
  revalidatePath("/inventory/[id]", "page");
  revalidatePath("/rigs");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/my");
  if (itemId) revalidatePath(`/inventory/${encodeURIComponent(itemId)}`);
}

/** Name of the signed-in person, from the People tab, else their email. */
async function whoIs(user: { email?: string | null; personId?: string }) {
  const people = await getStore().list("people");
  const email = (user.email ?? "").toLowerCase();
  const person =
    people.find((p) => user.personId && p.person_id === user.personId) ??
    people.find((p) => p.linked_user.toLowerCase() === email);
  return { email, name: person?.name ?? email };
}

/* ------------------------------------------------------------------ */
/* ADD A RIG: Admin and IM                                             */
/* ------------------------------------------------------------------ */

export type RigLookup = {
  brand: string;
  model: string;
  prismNo: string;
  penalty: string;
  details: [string, string][];
};

/**
 * Look a rig up in the rig reference sheet. null = not found.
 * { error } = the sheet could not be read, with the reason in plain words.
 */
export async function lookupRig(rigId: string): Promise<RigLookup | { error: string } | null> {
  const user = await requireRole("admin", "im");
  if (!canSeeType(user.role, "rig")) return null;

  let records;
  try {
    records = await loadRigRecords();
  } catch (error) {
    console.error("Rig sheet lookup failed:", error);
    return { error: rigSheetError(error) };
  }

  const found = findRig(records, rigId);
  if (!found) return null;

  return {
    brand: found.brand,
    model: found.model,
    prismNo: found.prismNo,
    penalty: found.penalty,
    details: found.details,
  };
}

export async function addRig(formData: FormData) {
  const user = await requireRole("admin", "im");

  const reject = (message: string): never =>
    redirect(`/inventory?${new URLSearchParams({ type: "rig", addError: message })}`);

  const rigId = String(formData.get("itemId") ?? "").trim();
  const penalty = String(formData.get("price") ?? "").replace(/[^0-9]/g, "");

  if (!rigId) reject("Scan or type the rig ID.");
  if (!penalty || Number(penalty) <= 0) reject("Enter the penalty amount for this rig.");

  // Details from the rig sheet are saved with the rig (looked up again on the server).
  let details: [string, string][] = [];
  try {
    details = findRig(await loadRigRecords(), rigId)?.details ?? [];
  } catch {
    details = [];
  }

  const store = getStore();
  const [items, hubs] = await Promise.all([store.list("items"), store.list("hubs")]);

  // Rigs always belong to the Bangalore hub, whatever the form sends.
  const homeHub = rigHomeHub(hubs)?.hub_id ?? "";
  if (!homeHub) reject("No active hub named Bangalore. Add it on the Hubs page first.");

  const plan = planAddItem(
    {
      itemId: rigId,
      homeHub,
      prismNo: "", // rigs have no prism number
      brand: String(formData.get("brand") ?? "").trim(),
      model: String(formData.get("model") ?? "").trim(),
      price: penalty,
      itemType: "rig",
      attributes: details.length ? JSON.stringify(Object.fromEntries(details)) : "",
    },
    items,
    {
      hubs,
      by: user.email ?? "unknown",
      now: istTimestamp(),
      newId,
    }
  );

  if (plan.errors.length || !plan.item || !plan.event) {
    reject(plan.errors.join(" ") || "The rig could not be prepared. Nothing was saved.");
  }

  await store.commitBatch([plan.event!], [plan.item!]);

  // Every new rig starts as "QC pending".
  const me = await whoIs(user);
  await store.appendRows("qc_checks", [
    {
      check_id: newId("qc"),
      item_id: plan.item!.item_id,
      recorded_at: istTimestamp(),
      recorded_by: me.email,
      recorded_by_name: me.name,
      qc_status: "qc_pending",
      comment: "Added to inventory",
    },
  ]);

  refresh(plan.item!.item_id);
  redirect(`/inventory?${new URLSearchParams({ type: "rig", added: plan.item!.item_id })}`);
}

/* ------------------------------------------------------------------ */
/* HARDWARE UPDATE: Admin, IM and Hardware team                        */
/* ------------------------------------------------------------------ */

async function rigOrFail(itemId: string, back: string) {
  const item = await getStore().getItem(itemId);
  if (!item || itemType(item) !== "rig") {
    redirect(`${back}?${new URLSearchParams({ error: "Rig not found." })}`);
  }
  return item!;
}

export async function addHardwareUpdate(formData: FormData) {
  const user = await requireRole(...HARDWARE_ROLES);

  const itemId = String(formData.get("itemId") ?? "").trim();
  const back = `/inventory/${encodeURIComponent(itemId)}`;
  await rigOrFail(itemId, back);

  const updateType = String(formData.get("updateType") ?? "").trim().slice(0, 60);
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 1000);

  if (!updateType && !comment) {
    redirect(`${back}?${new URLSearchParams({ error: "Choose an update type or write a comment." })}`);
  }

  const me = await whoIs(user);
  await getStore().appendRows("hardware_updates", [
    {
      update_id: newId("hw"),
      item_id: itemId,
      recorded_at: istTimestamp(),
      recorded_by: me.email,
      recorded_by_name: me.name,
      update_type: updateType,
      comment,
    },
  ]);

  refresh(itemId);
  redirect(`${back}?${new URLSearchParams({ done: "hardware" })}`);
}

/* ------------------------------------------------------------------ */
/* QC RESULT: Admin, IM and QC team                                    */
/* ------------------------------------------------------------------ */

export async function addQcCheck(formData: FormData) {
  const user = await requireRole(...QC_ROLES);

  const itemId = String(formData.get("itemId") ?? "").trim();
  const back = `/inventory/${encodeURIComponent(itemId)}`;
  await rigOrFail(itemId, back);

  const status = String(formData.get("qcStatus") ?? "") as QcStatus;
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 1000);

  if (!QC_STATUSES.includes(status)) {
    redirect(`${back}?${new URLSearchParams({ error: "Choose QC pending, Pass or Fail." })}`);
  }
  if (status === "fail" && !comment) {
    redirect(`${back}?${new URLSearchParams({ error: "Add a comment explaining why QC failed." })}`);
  }

  const me = await whoIs(user);
  await getStore().appendRows("qc_checks", [
    {
      check_id: newId("qc"),
      item_id: itemId,
      recorded_at: istTimestamp(),
      recorded_by: me.email,
      recorded_by_name: me.name,
      qc_status: status,
      comment,
    },
  ]);

  refresh(itemId);
  redirect(`${back}?${new URLSearchParams({ done: "qc" })}`);
}
/* ------------------------------------------------------------------ */
/* ADD MANY RIGS AT ONCE: Admin and IM                                 */
/* ------------------------------------------------------------------ */

const RIG_BULK_LIMIT = 200;

export type RigCheck = {
  rigId: string;
  status: "ready" | "exists" | "repeated" | "notfound" | "nopenalty";
  brand: string;
  model: string;
  penalty: string;
};

/** Check a list of rig IDs against the inventory and the rig sheet. */
export async function checkRigs(ids: string[]): Promise<{ rows: RigCheck[]; error?: string }> {
  const user = await requireRole("admin", "im");
  if (!canSeeType(user.role, "rig")) return { rows: [] };

  let records;
  try {
    records = await loadRigRecords();
  } catch (error) {
    console.error("Rig sheet lookup failed:", error);
    return { rows: [], error: rigSheetError(error) };
  }

  const inInventory = new Set((await getStore().list("items")).map((i) => i.item_id.toUpperCase()));
  const seen = new Set<string>();
  const rows: RigCheck[] = [];

  for (const raw of ids.slice(0, RIG_BULK_LIMIT)) {
    const rigId = String(raw ?? "").trim();
    if (!rigId) continue;
    const key = rigId.toUpperCase();
    const found = findRig(records, rigId);
    const base = { rigId, brand: found?.brand ?? "", model: found?.model ?? "", penalty: found?.penalty ?? "" };

    if (seen.has(key)) rows.push({ ...base, status: "repeated" });
    else if (inInventory.has(key)) rows.push({ ...base, status: "exists" });
    else if (!found) rows.push({ ...base, status: "notfound" });
    else if (!found.penalty) rows.push({ ...base, status: "nopenalty" });
    else rows.push({ ...base, status: "ready" });
    seen.add(key);
  }
  return { rows };
}

export type RigBulkResult = { added: string[]; skipped: { rigId: string; reason: string }[]; error?: string };

/**
 * Add many rigs at once. Every rig: home hub Bangalore, details and penalty from the rig sheet
 * (looked up again here, not taken from the browser), in stock, QC pending.
 */
export async function addRigs(ids: string[]): Promise<RigBulkResult> {
  const user = await requireRole("admin", "im");
  if (!canSeeType(user.role, "rig")) return { added: [], skipped: [], error: "Not allowed." };

  const list = (ids ?? []).map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, RIG_BULK_LIMIT);
  if (!list.length) return { added: [], skipped: [], error: "There are no rigs to add." };

  let records;
  try {
    records = await loadRigRecords();
  } catch (error) {
    return { added: [], skipped: [], error: rigSheetError(error) };
  }

  const store = getStore();
  const [items, hubs] = await Promise.all([store.list("items"), store.list("hubs")]);
  const homeHub = rigHomeHub(hubs)?.hub_id ?? "";
  if (!homeHub) return { added: [], skipped: [], error: "No active hub named Bangalore. Add it on the Hubs page first." };

  const known = [...items];
  const events: Parameters<typeof store.commitBatch>[0] = [];
  const toSave: Parameters<typeof store.commitBatch>[1] = [];
  const skipped: RigBulkResult["skipped"] = [];
  const now = istTimestamp();

  for (const rigId of list) {
    const found = findRig(records, rigId);
    if (!found) {
      skipped.push({ rigId, reason: "not in the rig sheet" });
      continue;
    }
    if (!found.penalty) {
      skipped.push({ rigId, reason: "no penalty amount in the rig sheet" });
      continue;
    }
    const plan = planAddItem(
      {
        itemId: found.rigId,
        homeHub,
        prismNo: "",
        brand: found.brand,
        model: found.model,
        price: found.penalty,
        itemType: "rig",
        attributes: found.details.length ? JSON.stringify(Object.fromEntries(found.details)) : "",
      },
      known,
      { hubs, by: user.email ?? "unknown", now, newId }
    );
    if (plan.errors.length || !plan.item || !plan.event) {
      skipped.push({ rigId, reason: plan.errors.join(" ") || "could not be prepared" });
      continue;
    }
    known.push(plan.item);
    events.push(plan.event);
    toSave.push(plan.item);
  }

  if (!toSave.length) return { added: [], skipped };

  await store.commitBatch(events, toSave);

  // Every new rig starts as "QC pending".
  const me = await whoIs(user);
  await store.appendRows(
    "qc_checks",
    toSave.map((item) => ({
      check_id: newId("qc"),
      item_id: item.item_id,
      recorded_at: now,
      recorded_by: me.email,
      recorded_by_name: me.name,
      qc_status: "qc_pending" as const,
      comment: "Added to inventory",
    }))
  );

  refresh();
  return { added: toSave.map((i) => i.item_id), skipped };
}
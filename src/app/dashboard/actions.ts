"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { displayName } from "@/lib/actors";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

const SAFE_BACK = /^\/dashboard(\?[\w=&%.\-,#]*)?$/;

/**
 * Only Abhishek Yadav (by name — no login email was given for a stricter check) may edit the Broken
 * tile's "starting count" override. Matched case-insensitively against the display name computed the
 * same way `byName` below is, so it still matches if the Person row's name has different casing.
 */
const CAN_EDIT_BROKEN_BASELINE = (name: string) => name.trim().toLowerCase() === "abhishek yadav";

/**
 * Admin-set override for the Broken tile's "Storage wise" breakdown on the dashboard: a manual
 * 256 GB / 512 GB count, used instead of the computed one (many broken cards never had their
 * storage attribute recorded, so the computed breakdown is often mostly "Not set"). Restricted to
 * Abhishek Yadav (see CAN_EDIT_BROKEN_BASELINE) on top of the usual admin check — the dashboard UI
 * already hides the box from everyone else, this is the server-side backstop.
 * Stored as JSON in the settings tab under key "broken_storage". Clear both fields to remove the
 * override and go back to the computed breakdown.
 */
export async function setBrokenStorageOverride(formData: FormData) {
  const user = await requireRole("admin");

  const backRaw = String(formData.get("back") ?? "/dashboard");
  const back = SAFE_BACK.test(backRaw) ? backRaw : "/dashboard";

  const gb256Raw = String(formData.get("gb256") ?? "").trim();
  const gb512Raw = String(formData.get("gb512") ?? "").trim();
  const store = getStore();
  const people = await store.list("people");
  const now = istTimestamp();
  const by = (user.email ?? "unknown").toLowerCase();
  const byName = displayName(people, user.personId ?? "") || user.name || user.email || "";

  if (!CAN_EDIT_BROKEN_BASELINE(byName)) {
    redirect(back);
  }

  // Both blank clears the override — the dashboard falls back to the computed breakdown.
  const value =
    gb256Raw === "" && gb512Raw === ""
      ? ""
      : JSON.stringify({ gb256: Math.max(0, Number(gb256Raw) || 0), gb512: Math.max(0, Number(gb512Raw) || 0) });

  const row = { key: "broken_storage", value, updated_at: now, updated_by: by, updated_by_name: byName };
  try {
    await store.upsert("settings", [row]);
  } catch {
    // First write ever: the "settings" tab doesn't exist yet. Create every tab that's missing, then retry.
    await store.init();
    await store.upsert("settings", [row]);
  }

  revalidatePath("/dashboard");
  redirect(back);
}

/**
 * Admin-set starting count for the Retired tile: a one-time baseline for items retired before this
 * system tracked them, added on top of the live count of items actually marked retired here — same
 * idea as the Broken tile's "Starting count" box, just a single number instead of a 256/512 split.
 * Stored as plain text in the settings tab under key "retired_baseline". Blank clears it.
 */
export async function setRetiredBaseline(formData: FormData) {
  const user = await requireRole("admin");

  const backRaw = String(formData.get("back") ?? "/dashboard");
  const back = SAFE_BACK.test(backRaw) ? backRaw : "/dashboard";

  const countRaw = String(formData.get("count") ?? "").trim();
  const store = getStore();
  const people = await store.list("people");
  const now = istTimestamp();
  const by = (user.email ?? "unknown").toLowerCase();
  const byName = displayName(people, user.personId ?? "") || user.name || user.email || "";

  const value = countRaw === "" ? "" : String(Math.max(0, Number(countRaw) || 0));

  const row = { key: "retired_baseline", value, updated_at: now, updated_by: by, updated_by_name: byName };
  try {
    await store.upsert("settings", [row]);
  } catch {
    await store.init();
    await store.upsert("settings", [row]);
  }

  revalidatePath("/dashboard");
  redirect(back);
}

/**
 * Add a manual note to the "Needs attention" section — a free-text flag anyone viewing the dashboard
 * can raise (e.g. "Chase Pune about 3 missing cards"), with an optional "by when" date. Recorded under
 * the logged-in person's name, same as a handover note.
 */
export async function addAttentionNote(formData: FormData) {
  const user = await requireRole();

  const backRaw = String(formData.get("back") ?? "/dashboard");
  const back = SAFE_BACK.test(backRaw) ? backRaw : "/dashboard";

  const note = String(formData.get("note") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "").trim();

  if (!note) {
    redirect(back);
  }

  const store = getStore();
  const people = await store.list("people");
  const now = istTimestamp();
  const by = (user.email ?? "unknown").toLowerCase();
  const byName = displayName(people, user.personId ?? "") || user.name || user.email || "";

  const row = {
    note_id: `an_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    note,
    due_date: dueDate,
    status: "open",
    recorded_at: now,
    recorded_by: by,
    recorded_by_name: byName,
  };

  try {
    await store.appendRows("attention_notes", [row]);
  } catch {
    await store.init();
    await store.appendRows("attention_notes", [row]);
  }

  revalidatePath("/dashboard");
  redirect(back);
}

/**
 * Mark a manual attention note done (or reopen it) — kept in the table either way, so there's a record
 * of what was raised and when it was cleared, rather than deleting it outright.
 */
export async function setAttentionNoteStatus(formData: FormData) {
  await requireRole();

  const backRaw = String(formData.get("back") ?? "/dashboard");
  const back = SAFE_BACK.test(backRaw) ? backRaw : "/dashboard";

  const noteId = String(formData.get("note_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() === "done" ? "done" : "open";
  if (!noteId) redirect(back);

  const store = getStore();
  // upsert() always writes every column of the table, so a bare {note_id, status} object would blank
  // out this row's note text, due date and who-recorded-it fields. Read the row first and send it back
  // whole, with just status changed.
  const existing = (await store.list("attention_notes")).find((r) => r.note_id === noteId);
  if (existing) await store.upsert("attention_notes", [{ ...existing, status }]);

  revalidatePath("/dashboard");
  redirect(back);
}

/**
 * Add a note against one specific delayed card, from the "Needs attention" drill-down table. Logged
 * separately (see dashboard/page.tsx "Delay notes" table) with a snapshot of who it was with and who
 * sent it, so the log still makes sense after the item itself moves on.
 */
export async function addDelayNote(formData: FormData) {
  const user = await requireRole();

  const backRaw = String(formData.get("back") ?? "/dashboard");
  const back = SAFE_BACK.test(backRaw) ? backRaw : "/dashboard";

  const itemId = String(formData.get("item_id") ?? "").trim();
  const itemType = String(formData.get("item_type") ?? "").trim();
  const person = String(formData.get("person") ?? "").trim();
  const sentBy = String(formData.get("sent_by") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!itemId || !note) {
    redirect(back);
  }

  const store = getStore();
  const people = await store.list("people");
  const now = istTimestamp();
  const by = (user.email ?? "unknown").toLowerCase();
  const byName = displayName(people, user.personId ?? "") || user.name || user.email || "";

  const row = {
    note_id: `dn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    item_id: itemId,
    item_type: itemType,
    person,
    sent_by: sentBy,
    note,
    recorded_at: now,
    recorded_by: by,
    recorded_by_name: byName,
  };

  try {
    await store.appendRows("delay_notes", [row]);
  } catch {
    await store.init();
    await store.appendRows("delay_notes", [row]);
  }

  revalidatePath("/dashboard");
  redirect(back);
}
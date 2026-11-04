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
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { displayName } from "@/lib/actors";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

const SAFE_BACK = /^\/dashboard(\?[\w=&%.\-,#]*)?$/;

/**
 * Admin-set override for the Broken tile's "Storage wise" breakdown on the dashboard: a manual
 * 256 GB / 512 GB count, used instead of the computed one (many broken cards never had their
 * storage attribute recorded, so the computed breakdown is often wrong or mostly "Not set").
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
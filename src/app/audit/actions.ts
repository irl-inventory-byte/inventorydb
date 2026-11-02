"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { displayName } from "@/lib/actors";
import { VIEW_ROLES, storeForAll } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

const SAFE_BACK = /^\/audit(\?[\w=&%.\-,]*)?$/;

/**
 * City / Hub Audit: log a confirmation that the selected (in-stock) items were physically checked
 * and are really there. Doesn't touch status, hub or holder — just a record, shown in each item's
 * History on its detail page.
 */
export async function markAudited(formData: FormData) {
  const user = await requireRole(...VIEW_ROLES);

  const backRaw = String(formData.get("back") ?? "/audit");
  const back = SAFE_BACK.test(backRaw) ? backRaw : "/audit";
  const redirectTo = (q: Record<string, string>) => {
    const sep = back.includes("?") ? "&" : "?";
    redirect(`${back}${sep}${new URLSearchParams(q)}`);
  };

  const ids = [...new Set(formData.getAll("ids").map(String).map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) redirectTo({ error: "Tick at least one item to audit." });

  const store = storeForAll(user.role);
  const found = await store.getItemsByIds(ids);
  const validIds = ids.filter((id) => found.has(id));
  if (!validIds.length) redirectTo({ error: "None of the selected items were found." });

  const people = await store.list("people");
  const now = istTimestamp();
  const by = (user.email ?? "unknown").toLowerCase();
  const byName = displayName(people, user.personId ?? "") || user.name || user.email || "";

  await getStore().appendRows(
    "audits",
    validIds.map((id) => ({
      audit_id: `au-${randomUUID().slice(0, 8)}`,
      item_id: id,
      audited_at: now,
      audited_by: by,
      audited_by_name: byName,
    })),
  );

  revalidatePath("/audit");
  redirectTo({ audited: String(validIds.length) });
}
"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { storeForAll } from "@/lib/access";
import { displayName } from "@/lib/actors";
import { requireRole } from "@/lib/authz";
import { planCorrection } from "@/lib/correction";
import { collectIds } from "@/lib/scan";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

/** Lost items: Admin and IM can add a free-text investigation note to a lost (or broken) item. */
export async function addLostNote(formData: FormData) {
  const user = await requireRole("admin", "im");

  const itemId = String(formData.get("item") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 2000);
  const statusRaw = String(formData.get("status") ?? "lost").trim();
  const status = statusRaw === "damaged" ? "damaged" : "lost";
  const back = (q: Record<string, string>) => redirect(`/lost?${new URLSearchParams({ status, ...q })}`);

  if (!itemId) back({ error: "Missing item." });
  if (note.length < 3) back({ error: "Add a note (at least 3 characters).", item: itemId });

  const store = getStore();
  const found = await store.getItemsByIds([itemId]);
  if (!found.has(itemId)) back({ error: "This item was not found." });

  const people = await store.list("people");

  await store.appendRows("lost_notes", [
    {
      note_id: `ln-${randomUUID().slice(0, 8)}`,
      item_id: itemId,
      note,
      recorded_at: istTimestamp(),
      recorded_by: (user.email ?? "unknown").toLowerCase(),
      recorded_by_name: displayName(people, user.personId ?? "") || user.name || user.email || "",
    },
  ]);
  revalidatePath("/lost");
  back({ saved: "1", item: itemId });
}

/**
 * Report lost/broken by scan: Admin and IM scan (or paste) one or more item codes and give a
 * required note. Reuses the same Correction machinery as the Inventory page's Correct form (a
 * "correct" event is what lostList() reads as the original report), just scoped to one target
 * status and with no hub/holder fields to fill in.
 */
export async function reportLostScan(formData: FormData) {
  const user = await requireRole("admin", "im");

  const statusRaw = String(formData.get("status") ?? "lost").trim();
  const status = statusRaw === "damaged" ? "damaged" : "lost";
  const label = status === "damaged" ? "broken" : "lost";
  const back = (q: Record<string, string>) => redirect(`/lost?${new URLSearchParams({ status, ...q })}`);

  const note = String(formData.get("note") ?? "").trim().slice(0, 2000);
  if (note.length < 3) back({ error: "Add a note (at least 3 characters) saying why.", status });

  const ids = collectIds(String(formData.get("scanned") ?? ""));
  if (!ids.length) back({ error: "Scan or enter at least one item." });

  const store = storeForAll(user.role);
  const found = await store.getItemsByIds(ids);
  const missing = ids.filter((id) => !found.has(id));

  // Different spellings of the same stored serial count once; items already at the target status
  // are left alone instead of logging a duplicate report.
  const targets = [...new Map(ids.filter((id) => found.has(id)).map((id) => [found.get(id)!.item_id, found.get(id)!])).values()];
  const already = targets.filter((t) => t.status === status).length;
  const toReport = targets.filter((t) => t.status !== status);

  if (!toReport.length) {
    back({
      error: missing.length
        ? `Not found: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}. Nothing was saved.`
        : `Already marked ${label}. Nothing was saved.`,
    });
  }

  const [hubs, people] = await Promise.all([store.list("hubs"), store.list("people")]);

  const plan = planCorrection(
    toReport,
    { status, hub: "", holder: "", homeHub: "", note },
    {
      hubs,
      people,
      by: user.email ?? "unknown",
      now: istTimestamp(),
      newId: (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`,
    },
  );

  if (plan.errors.length) back({ error: `${plan.errors.join(" ")} Nothing was saved.` });

  if (plan.items.length) {
    await getStore().commitBatch(plan.events, plan.items);
    revalidatePath("/lost");
    revalidatePath("/dashboard");
    revalidatePath("/inventory");
  }

  back({ reported: String(plan.items.length), already: String(already), missing: String(missing.length) });
}
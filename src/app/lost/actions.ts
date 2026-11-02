"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { displayName } from "@/lib/actors";
import { requireRole } from "@/lib/authz";
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
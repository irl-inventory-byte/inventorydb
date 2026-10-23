"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { displayName } from "@/lib/actors";
import { storeFor } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

// A Google Sheets cell holds at most 50,000 characters; the phone shrinks the photo to fit under this.
const MAX_PHOTO = 48_000;

/** Unknown rigs: Admin, IM and Hardware team add a report (location, reason, photo) for a rig. */
export async function addRigReport(formData: FormData) {
  const user = await requireRole("admin", "im", "hardware");
  const text = (name: string, max: number) => String(formData.get(name) ?? "").trim().slice(0, max);
  const rigId = text("rig", 200);
  const back = (q: Record<string, string>) =>
    redirect(`/rigs/unknown?${new URLSearchParams({ rig: rigId, ...q })}#report`);

  const location = text("location", 300);
  const reason = text("reason", 1000);
  const photo = String(formData.get("photo") ?? "");
  if (!location) back({ error: "Write where the rig is (location)." });
  if (!reason) back({ error: "Write the reason." });
  if (photo && (!photo.startsWith("data:image/jpeg;base64,") || photo.length > MAX_PHOTO)) {
    back({ error: "The photo could not be saved. Take it again." });
  }

  const store = storeFor(user.role, "rig");
  const [rigs, people] = await Promise.all([store.list("items"), store.list("people")]);
  const rig = rigs.find((r) => r.item_type === "rig" && r.item_id === rigId);
  if (!rig) back({ error: "This rig was not found." });

  await getStore().appendRows("rig_reports", [
    {
      report_id: `rr-${randomUUID().slice(0, 8)}`,
      item_id: rigId,
      recorded_at: istTimestamp(),
      recorded_by: (user.email ?? "unknown").toLowerCase(),
      recorded_by_name: displayName(people, user.personId ?? "") || user.name || user.email || "",
      location,
      reason,
      photo,
    },
  ]);
  revalidatePath("/rigs/unknown");
  back({ saved: "1" });
}
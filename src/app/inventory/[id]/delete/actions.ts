"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

export async function deleteInventoryItem(
  formData: FormData
): Promise<void> {
  // Server-side protection, even if someone bypasses the UI.
  const admin = await requireRole("admin");

  const itemId = String(
    formData.get("itemId") ?? ""
  ).trim();

  const confirmation = String(
    formData.get("confirmation") ?? ""
  );

  const acknowledged =
    formData.get("deleteHistory") === "yes";
  
  const reason = String(
    formData.get("reason") ?? ""
  ).trim().slice(0, 500);  

  if (!itemId) {
    redirect(
      `/inventory?${new URLSearchParams({
        error: "An item ID is required.",
      })}`
    );
  }

  const deletePage =
    `/inventory/${encodeURIComponent(itemId)}/delete`;

  if (
    confirmation !== itemId ||
    !acknowledged
  ) {
    redirect(
      `${deletePage}?${new URLSearchParams({
        error:
          "Enter the exact serial and confirm that its history will also be deleted.",
      })}`
    );
  }

  let failure = false;
  const store = getStore();

  try {
    // Snapshot the item and its history before they are removed. getItemFresh (not getItem): a stale
    // per-instance cache here would just put wrong/blank details in the audit log, not block the
    // deletion itself, but there's no reason to let the log be wrong when it's cheap to avoid.
    const [item, history] = await Promise.all([
      store.getItemFresh(itemId),
      store.getHistory(itemId),
    ]);

    const result = await store.deleteItemAndHistory(itemId);

    // AUDIT LOG: which admin deleted the item, and when.
    // A logging problem must not undo or hide a completed deletion.
    try {
      let historyJson = JSON.stringify(history ?? []);
      if (historyJson.length > 45000) {
        historyJson = historyJson.slice(0, 45000) + "…(trimmed)";
      }

      await store.logDeletion({
        deletion_id: `d-${randomUUID().slice(0, 8)}`,
        deleted_at: istTimestamp(),
        deleted_by_email: admin.email ?? "unknown",
        deleted_by_name: admin.name ?? "",
        item_id: item?.item_id ?? itemId,
        prism_no: item?.prism_no ?? "",
        brand: item?.brand ?? "",
        model: item?.model ?? "",
        price: item?.price ?? "",
        attributes: item?.attributes ?? "",
        status: item?.status ?? "",
        current_hub: item?.current_hub ?? "",
        current_holder: item?.current_holder ?? "",
        home_hub: item?.home_hub ?? "",
        events_deleted: String(result.deletedEvents),
        reason,
        history_json: historyJson,
      });
    } catch (logError) {
      console.error(
        `Item ${itemId} was deleted, but the deletions log could not be written:`,
        logError
      );
    }
  } catch (error) {
    // Detailed diagnostic stays on the server.
    console.error("Inventory deletion failed:", error);
    failure = true;
  }

  // Keep redirects outside try/catch.
  if (failure) {
    redirect(
      `${deletePage}?${new URLSearchParams({
        error:
          "Deletion could not be confirmed. Check inventory and server logs before retrying. The active backend must support deletion.",
      })}`
    );
  }

  revalidatePath("/inventory");
  revalidatePath("/admin/deletions");
  revalidatePath("/inventory/[id]", "page");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/analytics");
  revalidatePath("/dashboard/my");
  revalidatePath("/dashboard/hub/[id]", "page");
  revalidatePath("/handover/receipt/[batch]", "page");

  redirect(
    `/inventory?${new URLSearchParams({
      deleted: itemId,
    })}`
  );
}
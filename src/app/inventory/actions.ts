"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { planAddItem } from "@/lib/add-item";
import {
  findAsset,
  normalizeCapacity,
} from "@/lib/asset-lookup";
import { assetSheetError, loadAssetRecords } from "@/lib/asset-sheet";
import { requireRole } from "@/lib/authz";
import { planCorrection } from "@/lib/correction";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

// Only redirect to inventory pages.
const SAFE_BACK = /^\/inventory(\/[A-Za-z0-9_-]+)?$/;

function backTo(
  path: string,
  params: Record<string, string>
): string {
  return `${path}?${new URLSearchParams(params)}`;
}

// Fixed penalty based on storage.
function penaltyForCapacity(capacity: string): string {
  if (capacity === "256 GB") return "10000";
  if (capacity === "512 GB") return "20000";
  return "";
}

function refreshInventoryPages() {
  revalidatePath("/inventory");
  revalidatePath("/inventory/[id]", "page");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/analytics");
  revalidatePath("/dashboard/my");
  revalidatePath("/dashboard/hub/[id]", "page");
}

/**
 * CORRECTIONS: Admin only.
 * IM and Rig do not gain correction permission.
 */
export async function applyCorrection(formData: FormData) {
  const user = await requireRole("admin");

  const backRaw = String(formData.get("back") ?? "");
  const back = SAFE_BACK.test(backRaw)
    ? backRaw
    : "/inventory";

  const scanned = String(formData.get("scanned") ?? "")
    .split(/[\s,]+/);

  const ids = [
    ...new Set(
      [...formData.getAll("ids").map(String), ...scanned]
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];

  if (!ids.length) {
    redirect(
      backTo(back, {
        error: "Tick or scan at least one item.",
      })
    );
  }

  const store = getStore();

  const [found, hubs, people] = await Promise.all([
    store.getItemsByIds(ids),
    store.list("hubs"),
    store.list("people"),
  ]);

  const missing = ids.filter((id) => !found.has(id));

  if (missing.length) {
    const shown = missing.slice(0, 5).join(", ");

    redirect(
      backTo(back, {
        error: `Not found: ${shown}${
          missing.length > 5
            ? ` and ${missing.length - 5} more`
            : ""
        }. Nothing was saved.`,
      })
    );
  }

  // Different spellings of the same stored serial count once.
  const targets = [
    ...new Map(
      ids.map((id) => [
        found.get(id)!.item_id,
        found.get(id)!,
      ])
    ).values(),
  ];

  const plan = planCorrection(
    targets,
    {
      status: String(formData.get("status") ?? ""),
      hub: String(formData.get("hub") ?? ""),
      holder: String(formData.get("holder") ?? ""),
      homeHub: String(formData.get("homeHub") ?? ""),
      note: String(formData.get("note") ?? ""),
    },
    {
      hubs,
      people,
      by: user.email ?? "unknown",
      now: istTimestamp(),
      newId: (prefix) =>
        `${prefix}-${randomUUID().slice(0, 8)}`,
    }
  );

  if (plan.errors.length) {
    redirect(
      backTo(back, {
        error: `${plan.errors.join(" ")} Nothing was saved.`,
      })
    );
  }

  if (plan.items.length) {
    await store.commitBatch(plan.events, plan.items);
    refreshInventoryPages();
  }

  redirect(
    backTo(back, {
      done: String(plan.items.length),
      same: String(plan.unchanged.length),
    })
  );
}

/**
 * ADD ITEM: Admin, IM and Rig.
 *
 * Home hub is required; there is no default.
 * Store storage/colour in attributes and penalty in price.
 */
export async function addItem(formData: FormData) {
  const user = await requireRole("admin", "im", "rig");

  const capacity = normalizeCapacity(
    String(formData.get("capacity") ?? "")
  );

  const cardType = String(
    formData.get("cardType") ?? ""
  ).trim();

  function reject(message: string): never {
    redirect(
      `/inventory?${new URLSearchParams({
        addError: message,
      })}`
    );
  }

  if (!["256 GB", "512 GB"].includes(capacity)) {
    reject(
      "Select 256 GB or 512 GB to calculate the penalty."
    );
  }

  if (
    cardType &&
    !["Black", "Green"].includes(cardType)
  ) {
    reject("Card type must be Black or Green.");
  }

  // Calculate on the server; ignore the submitted price.
  const price = penaltyForCapacity(capacity);

  const input = {
    itemId: String(formData.get("itemId") ?? "").trim(),
    homeHub: String(formData.get("homeHub") ?? "").trim(),
    prismNo: String(formData.get("prismNo") ?? "").trim(),
    brand: String(formData.get("brand") ?? "").trim(),
    model: String(formData.get("model") ?? "").trim(),
    price,
  };

  const store = getStore();

  const [items, hubs] = await Promise.all([
    store.list("items"),
    store.list("hubs"),
  ]);

  const activeHubs = hubs.filter(
    (hub) => hub.active !== "false"
  );

  // Home hub is mandatory. There is no default hub.
  if (!input.homeHub) {
    reject("Select the home hub.");
  }

  // Validate submitted values on the server, not only in the dropdown.
  if (
    !activeHubs.some(
      (hub) => hub.hub_id === input.homeHub
    )
  ) {
    reject("Please select a valid active home hub.");
  }

  // Preserve the existing item validation and creation plan.
  const plan = planAddItem(input, items, {
    hubs,
    by: user.email ?? "unknown",
    now: istTimestamp(),
    newId: (prefix) =>
      `${prefix}-${randomUUID().slice(0, 8)}`,
  });

  if (plan.errors.length) {
    reject(plan.errors.join(" "));
  }

  const item = plan.item;
  const event = plan.event;

  if (!item || !event) {
    reject(
      "The item could not be prepared. Nothing was saved."
    );
  }

  // Preserve attributes already generated by planAddItem.
  let attributes: Record<string, unknown> = {};

  if (item.attributes?.trim()) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(item.attributes);
    } catch {
      reject(
        "Could not read item attributes. Nothing was saved."
      );
    }

    // Keep redirects outside the JSON-parsing try/catch.
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      reject(
        "Invalid item attributes. Nothing was saved."
      );
    }

    attributes = parsed as Record<string, unknown>;
  }

  const itemToSave = {
    ...item,
    price,
    attributes: JSON.stringify({
      ...attributes,
      capacity,
      card_type: cardType,
    }),
  };

  await store.commitBatch([event], [itemToSave]);
  refreshInventoryPages();

  redirect(
    `/inventory?${new URLSearchParams({
      added: itemToSave.item_id,
    })}`
  );
}

/**
 * ASSET LOOKUP: Admin, IM and Rig.
 * Home hub is not fetched from the reference asset sheet.
 * { error } = the SD card sheet could not be read, with the reason in plain words.
 */
export async function lookupAsset(serial: string) {
  await requireRole("admin", "im", "rig");

  const cleanedSerial = serial.trim();

  if (!cleanedSerial) return null;

  let records;
  try {
    records = await loadAssetRecords();
  } catch (error) {
    console.error("SD card sheet lookup failed:", error);
    return { error: assetSheetError(error) };
  }
  const found = findAsset(records, cleanedSerial);

  if (!found) return null;

  const capacity = normalizeCapacity(
    found.capacity ?? ""
  );

  return {
    brand: found.brand,
    model: found.model,
    prismNo: found.prismNo,
    capacity,
    cardType: found.cardType ?? "",
    price: penaltyForCapacity(capacity),
  };
}
/* ------------------------------------------------------------------ */
/* ADD MULTIPLE ITEMS                                                  */
/* ------------------------------------------------------------------ */

const BULK_LIMIT = 200;

export type SerialCheck = {
  serial: string;
  /**
   * ready     – found in the asset sheet, not in inventory yet
   * exists    – already in the inventory
   * notfound  – not in the asset sheet
   * repeated  – the same serial appears earlier in the list
   */
  status: "ready" | "exists" | "notfound" | "repeated";
  prismNo: string;
  brand: string;
  model: string;
  capacity: string;
  cardType: string;
};

/**
 * CHECK SERIALS: Admin, IM and Rig.
 * Looks up every serial in the asset sheet in one go and flags the ones
 * already in the inventory, so the bulk form can show a table to review.
 * { error } = the SD card sheet could not be read, with the reason in plain words.
 */
export async function checkSerials(
  serials: string[]
): Promise<SerialCheck[] | { error: string }> {
  await requireRole("admin", "im", "rig");

  const cleaned = serials
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .slice(0, BULK_LIMIT);

  if (!cleaned.length) return [];

  let records, items;
  try {
    [records, items] = await Promise.all([
      loadAssetRecords().catch((error) => {
        console.error("SD card sheet lookup failed:", error);
        throw Object.assign(new Error("asset sheet"), { sheetError: assetSheetError(error) });
      }),
      getStore().list("items"),
    ]);
  } catch (error) {
    const sheetError = (error as { sheetError?: string }).sheetError;
    if (sheetError) return { error: sheetError };
    throw error;
  }

  const inInventory = new Set(
    items.map((item) => item.item_id.toUpperCase())
  );
  const seen = new Set<string>();

  return cleaned.map((serial): SerialCheck => {
    const key = serial.toUpperCase();
    const found = findAsset(records, serial);
    const capacity = normalizeCapacity(found?.capacity ?? "");
    const cardType = ["Black", "Green"].includes(found?.cardType ?? "")
      ? (found?.cardType ?? "")
      : "";

    const details = {
      serial,
      prismNo: found?.prismNo ?? "",
      brand: found?.brand ?? "",
      model: found?.model ?? "",
      capacity: ["256 GB", "512 GB"].includes(capacity) ? capacity : "",
      cardType,
    };

    if (seen.has(key)) return { ...details, status: "repeated" };
    seen.add(key);

    if (inInventory.has(key)) return { ...details, status: "exists" };
    if (!found) return { ...details, status: "notfound" };
    return { ...details, status: "ready" };
  });
}

export type BulkAddRow = {
  serial: string;
  prismNo: string;
  brand: string;
  model: string;
  capacity: string;
  cardType: string;
};

export type BulkAddResult = {
  added: string[];
  skipped: { serial: string; reason: string }[];
  error?: string;
};

/**
 * ADD MULTIPLE ITEMS: Admin, IM and Rig.
 * Same rules as addItem for every row: home hub required, storage
 * 256 GB / 512 GB, penalty worked out on the server from storage.
 * Rows that fail are skipped; the rest are saved together.
 */
export async function addItems(input: {
  homeHub: string;
  rows: BulkAddRow[];
}): Promise<BulkAddResult> {
  const user = await requireRole("admin", "im", "rig");

  const homeHub = String(input?.homeHub ?? "").trim();
  const rows = (input?.rows ?? []).slice(0, BULK_LIMIT);

  if (!homeHub) {
    return { added: [], skipped: [], error: "Select the home hub." };
  }
  if (!rows.length) {
    return { added: [], skipped: [], error: "There are no items to add." };
  }

  const store = getStore();
  const [items, hubs] = await Promise.all([
    store.list("items"),
    store.list("hubs"),
  ]);

  if (
    !hubs.some((hub) => hub.hub_id === homeHub && hub.active !== "false")
  ) {
    return {
      added: [],
      skipped: [],
      error: "Please select a valid active home hub.",
    };
  }

  // Grows as rows are planned, so a serial repeated in the list is caught too.
  const known = [...items];
  const events: Parameters<typeof store.commitBatch>[0] = [];
  const toSave: Parameters<typeof store.commitBatch>[1] = [];
  const skipped: BulkAddResult["skipped"] = [];
  const now = istTimestamp();

  for (const row of rows) {
    const serial = String(row?.serial ?? "").trim();
    const capacity = normalizeCapacity(String(row?.capacity ?? ""));
    const cardType = String(row?.cardType ?? "").trim();

    if (!["256 GB", "512 GB"].includes(capacity)) {
      skipped.push({ serial, reason: "Select 256 GB or 512 GB." });
      continue;
    }
    if (cardType && !["Black", "Green"].includes(cardType)) {
      skipped.push({ serial, reason: "Card type must be Black or Green." });
      continue;
    }

    const price = penaltyForCapacity(capacity);

    const plan = planAddItem(
      {
        itemId: serial,
        homeHub,
        prismNo: String(row?.prismNo ?? "").trim(),
        brand: String(row?.brand ?? "").trim(),
        model: String(row?.model ?? "").trim(),
        price,
      },
      known,
      {
        hubs,
        by: user.email ?? "unknown",
        now,
        newId: (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`,
      }
    );

    if (plan.errors.length || !plan.item || !plan.event) {
      skipped.push({
        serial,
        reason: plan.errors.join(" ") || "Could not be prepared.",
      });
      continue;
    }

    let attributes: Record<string, unknown> = {};
    try {
      const parsed: unknown = plan.item.attributes?.trim()
        ? JSON.parse(plan.item.attributes)
        : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        attributes = parsed as Record<string, unknown>;
      }
    } catch {
      // planAddItem leaves attributes empty; nothing to keep.
    }

    const item = {
      ...plan.item,
      price,
      attributes: JSON.stringify({
        ...attributes,
        capacity,
        card_type: cardType,
      }),
    };

    events.push(plan.event);
    toSave.push(item);
    known.push(item);
  }

  if (toSave.length) {
    await store.commitBatch(events, toSave);
    refreshInventoryPages();
  }

  return { added: toSave.map((item) => item.item_id), skipped };
}
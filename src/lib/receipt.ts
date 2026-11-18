import type { Action, AppUser, Hub, Item, ItemEvent, Person, Status } from "./schema";

export interface ReceiptLine {
  itemId: string;
  // "sd_card", "rig", "mobile" or "power_bank". Older items without a type are SD cards.
  itemType: string;
  brand: string;
  model: string;
  prismNo: string;

  // From the item's saved attributes, e.g. "256 GB" and "Black".
  storage: string;
  cardType: string;

  // Mobiles: Asset Tag, Serial and Category from the mobile sheet ("" for other items).
  assetTag: string;
  serial: string;
  category: string;

  // Original item price, as stored.
  price: string;

  statusAfter: Status;

  // Manually supplied penalty for this item, in rupees.
  penalty: number;
  penaltyReason: string;
}

export interface BatchSummary {
  returnInfo: any;
  // person_id (or an admin's email) behind fromName / toName.
  fromId: string;
  toId: string;
  batchId: string;
  action: Action;
  occurredAt: string;
  fromName: string;
  toName: string;

  // Where the items left from and where they went.
  fromHubId: string;
  fromHubName: string;
  hubId: string;
  hubName: string;

  // Signed-in account that recorded the handover, and when.
  recordedBy: string;
  recordedAt: string;
  // The name behind recordedBy's email — "" if no People/Users row matches it, in which case the
  // email in recordedBy is all there is to show. See the lookup in summarizeBatch below.
  recordedByName: string;
  note: string;
  items: ReceiptLine[];

  // Role of the FROM / TO person (e.g. "fo", "im"), from the people database at the moment the
  // receipt is built — "" when the row no longer exists, was never a real person (a typed "Internal"
  // name) or is an admin's email rather than a person_id.
  fromRole: string;
  toRole: string;

  // Item value only. This is not a charge or penalty.
  totalPrice: number | null;

  // Penalties are kept separate from item value.
  totalPenalty: number;
}

export interface ItemPenalty {
  amount: number;
  reason: string;
}

// Pass penalties for the requested batch, keyed by item ID.
// Missing entries have zero penalty.
export type PenaltiesByItem = Readonly<
  Record<string, ItemPenalty | undefined>
>;

/**
 * Format a stored item price in rupees.
 * Blank or invalid prices display as an empty string.
 */
export function formatPrice(raw: string): string {
  const n = Number(raw);

  if (raw.trim() === "" || !Number.isFinite(n)) {
    return "";
  }

  return `₹${n.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a penalty in rupees.
 * Zero is displayed explicitly.
 */
export function formatPenalty(amount: number): string {
  return `₹${validatePenaltyAmount(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function parsePrice(raw: string): number | undefined {
  const n = Number(raw);

  return raw.trim() !== "" && Number.isFinite(n)
    ? n
    : undefined;
}

/**
 * Reject invalid amounts rather than silently changing them.
 * Amounts are rounded to the nearest paise.
 */
function validatePenaltyAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(
      "Penalty must be a finite number greater than or equal to zero."
    );
  }

  const paise = Math.round(amount * 100);

  if (!Number.isSafeInteger(paise)) {
    throw new Error("Penalty amount is too large.");
  }

  return paise / 100;
}

/** Read storage and card colour from an item's saved attributes JSON. */
function readCardDetails(raw: string): { storage: string; cardType: string; assetTag: string; serial: string; category: string } {
  let attributes: Record<string, unknown> = {};

  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      attributes = parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid or missing details are shown as blank.
  }

  const text = (value: unknown) =>
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";

  // SD cards save "capacity"; mobiles save "Storage".
  const capacity = text(attributes.capacity) || text(attributes.Storage);
  const compact = capacity.replace(/\s+/g, "").toUpperCase();

  const storage =
    compact === "512GB" || compact === "512"
      ? "512 GB"
      : compact === "256GB" || compact === "256"
        ? "256 GB"
        : capacity;

  return {
    storage,
    cardType: text(attributes.card_type),
    assetTag: text(attributes["Asset Tag"]),
    serial: text(attributes.Serial),
    category: text(attributes.Category),
  };
}

/**
 * Extract the batch ID from a receipt URL or a plain ID.
 * Removes query strings, fragments and trailing slashes.
 */
export function extractBatchId(input: string): string {
  const trimmed = input.trim();

  if (!trimmed) {
    return "";
  }

  const withoutQuery = trimmed.split(/[#?]/, 1)[0];
  const withoutSlash = withoutQuery.replace(/\/+$/, "");
  const parts = withoutSlash.split("/");

  return parts[parts.length - 1];
}

/**
 * Summarize one batch handover.
 *
 * The optional fifth argument supplies penalties for this batch.
 * Existing calls with four arguments continue to work, with
 * every penalty defaulting to zero.
 *
 * This function calculates a summary only.
 * It does not save penalties or collect payments.
 */
export function summarizeBatch(
  events: ItemEvent[],
  items: Item[],
  hubs: Hub[],
  batchId: string,
  penaltiesByItem: PenaltiesByItem = {},
  // Optional: both default to [] so existing 4-argument calls keep working. Needed only to resolve
  // fromRole / toRole / recordedByName below — pass both when the caller has them loaded.
  people: Person[] = [],
  users: AppUser[] = [],
): BatchSummary | undefined {
  if (!batchId) {
    return undefined;
  }

  const rows = events.filter((e) => e.batch_id === batchId);

  if (rows.length === 0) {
    return undefined;
  }

  const first = rows[0];

  const itemById = new Map(
    items.map((i) => [i.item_id, i])
  );

  const nameOfHub = (id: string) =>
    hubs.find((h) => h.hub_id === id)?.name ?? id;

  const hubName = nameOfHub(first.hub);
  const fromHubId = first.from_hub ?? "";
  const fromHubName = fromHubId ? nameOfHub(fromHubId) : "";

  // Prevent duplicate event rows from applying the same
  // item-level penalty more than once within the batch.
  const penaltyApplied = new Set<string>();

  const lines: ReceiptLine[] = rows
    .map((r) => {
      const item = itemById.get(r.item_id);

      const configuredPenalty = Object.prototype.hasOwnProperty.call(
        penaltiesByItem,
        r.item_id
      )
        ? penaltiesByItem[r.item_id]
        : undefined;

      const applyPenalty =
        configuredPenalty !== undefined &&
        !penaltyApplied.has(r.item_id);

      const penalty = applyPenalty
        ? validatePenaltyAmount(configuredPenalty.amount)
        : 0;

      const penaltyReason = applyPenalty
        ? configuredPenalty.reason.trim()
        : "";

      if (penalty > 0 && !penaltyReason) {
        throw new Error(
          `A penalty reason is required for item ${r.item_id}.`
        );
      }

      if (applyPenalty) {
        penaltyApplied.add(r.item_id);
      }

      const details = readCardDetails(item?.attributes ?? "");

      return {
        itemId: r.item_id,
        itemType:
          item?.item_type === "rig"
            ? "rig"
            : item?.item_type === "mobile"
              ? "mobile"
              : item?.item_type === "power_bank"
                ? "power_bank"
                : "sd_card",
        brand: item?.brand ?? "",
        model: item?.model ?? "",
        prismNo: item?.prism_no ?? "",
        storage: details.storage,
        cardType: details.cardType,
        assetTag: details.assetTag,
        serial: details.serial,
        category: details.category,
        price: item?.price ?? "",
        statusAfter: r.status_after,
        penalty,
        penaltyReason,
      };
    })
    .sort((a, b) => a.itemId.localeCompare(b.itemId));

  const prices = lines
    .map((line) => parsePrice(line.price))
    .filter((n): n is number => n !== undefined);

  // Sum in paise to avoid ordinary decimal rounding artifacts.
  const totalPenaltyPaise = lines.reduce(
    (sum, line) => sum + Math.round(line.penalty * 100),
    0
  );

  if (!Number.isSafeInteger(totalPenaltyPaise)) {
    throw new Error("Total penalty amount is too large.");
  }

  // Role of the FROM / TO person, by person_id. An admin's email (not a real person_id) or a typed
  // "Internal" name simply won't match anything here, which is fine — the field just comes back "".
  const roleOf = new Map(people.map((p) => [p.person_id, p.role]));
  const fromRole = roleOf.get(first.from_id ?? "") ?? "";
  const toRole = roleOf.get(first.to_id ?? "") ?? "";

  // Name behind the recorded_by email: first by a matching active user account's linked person, then
  // by a People row whose own "linked_user" is that email. "" if neither matches (an email with no
  // People/Users row at all, e.g. an admin login that was never linked to anyone).
  const recordedByEmail = (first.recorded_by ?? "").trim().toLowerCase();
  const recordedByUser = recordedByEmail
    ? users.find((u) => u.email?.trim().toLowerCase() === recordedByEmail && u.active !== "false")
    : undefined;
  const recordedByPerson =
    (recordedByUser?.person_id && people.find((p) => p.person_id === recordedByUser.person_id)) ||
    (recordedByEmail ? people.find((p) => (p.linked_user ?? "").trim().toLowerCase() === recordedByEmail) : undefined);
  const recordedByName = recordedByPerson?.name ?? "";

  return {
    batchId,
    action: first.action,
    occurredAt: first.occurred_at,
    fromName: first.from_person,
    toName: first.to_person,
    fromHubId,
    fromHubName,
    hubId: first.hub,
    hubName,
    recordedBy: first.recorded_by ?? "",
    recordedAt: first.recorded_at ?? "",
    recordedByName,
    note: first.note,
    items: lines,
    totalPrice: prices.length
      ? prices.reduce((sum, price) => sum + price, 0)
      : null,
    totalPenalty: totalPenaltyPaise / 100,
    returnInfo: undefined,
    fromId: first.from_id ?? "",
    toId: first.to_id ?? "",
    fromRole,
    toRole,
  };
}
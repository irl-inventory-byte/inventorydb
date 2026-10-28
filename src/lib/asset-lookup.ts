/**
 * Details returned from the reference asset sheet.
 */
export interface AssetRecord {
  itemId: string;
  brand: string;
  model: string;
  prismNo: string;
  price: string;
  capacity?: string;
  cardType?: string;
  date?: string; // the sheet's "Date" column, as written in the sheet (shown on Add SD card only)
  condition?: string; // the sheet's "New/Old" column (shown on Add SD card only)
}

/**
 * Preserve this exported helper for existing imports.
 * Convert a rupee amount to a plain numeric string.
 */
export function cleanPrice(raw: string): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/₹/g, "")
    .replace(/\bINR\b/gi, "")
    .replace(/[,\s]/g, "");

  if (!cleaned || !/^\d+(?:\.\d+)?$/.test(cleaned)) {
    return "";
  }

  return Number.isFinite(Number(cleaned)) ? cleaned : "";
}

/** Normalize storage to the values supported by the form. */
export function normalizeCapacity(raw: string): string {
  const value = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();

  if (value === "256" || value === "256GB") {
    return "256 GB";
  }

  if (value === "512" || value === "512GB") {
    return "512 GB";
  }

  return "";
}

/**
 * Normalize explicit card colours.
 * Do not guess colour from storage, model or brand.
 */
export function normalizeCardType(raw: string): string {
  const value = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

  if (value === "black" || value === "black card") {
    return "Black";
  }

  if (value === "green" || value === "green card") {
    return "Green";
  }

  return "";
}

/** Fixed penalty based on the card's storage. */
function penaltyForCapacity(capacity: string): string {
  if (capacity === "256 GB") return "10000";
  if (capacity === "512 GB") return "20000";

  // Unknown storage does not mean a zero penalty.
  return "";
}

/**
 * Make header comparisons ignore case, spaces and punctuation.
 * For example, "Model No." and "model_no" both become "modelno".
 */
function normalizeHeader(raw: string): string {
  return String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Treat common placeholder text as missing.
 * Keep actual model identifiers unchanged.
 */
function cleanCell(raw: unknown): string {
  const value = String(raw ?? "").trim();

  if (
    /^(?:n\/a|n\.a\.|not available|not set|null|undefined|-|—)$/i.test(
      value
    )
  ) {
    return "";
  }

  return value;
}

/**
 * Parse a reference-sheet row.
 *
 * Preferred: pass row-1 headers so columns are matched by name.
 *
 * Legacy layout when no headers are supplied:
 * A: Asset Tag
 * B: SD Card Serial No
 * C: Storage
 * D: Country Origin
 * E: Brand
 * F: Model
 * G: Prism No.
 * H: Penalty
 * I: Status
 */
export function parseAssetRow(
  row: string[],
  tabCapacity = "",
  headers: string[] = []
): AssetRecord | null {
  const normalizedHeaders = headers.map(normalizeHeader);

  /**
   * Read non-empty cells from the specified header aliases.
   * A blank first matching column does not hide later values.
   */
  function columnValues(
    aliases: string[],
    legacyIndex?: number
  ): string[] {
    if (headers.length === 0) {
      if (legacyIndex === undefined) return [];

      const value = cleanCell(row[legacyIndex]);
      return value ? [value] : [];
    }

    const values: string[] = [];
    const visitedColumns = new Set<number>();

    for (const alias of aliases) {
      const expectedHeader = normalizeHeader(alias);

      for (
        let index = 0;
        index < normalizedHeaders.length;
        index++
      ) {
        if (
          normalizedHeaders[index] !== expectedHeader ||
          visitedColumns.has(index)
        ) {
          continue;
        }

        visitedColumns.add(index);

        const value = cleanCell(row[index]);

        if (value) {
          values.push(value);
        }
      }
    }

    return values;
  }

  function firstValue(
    aliases: string[],
    legacyIndex?: number
  ): string {
    return columnValues(aliases, legacyIndex)[0] ?? "";
  }

  // Match by Asset Tag, not by a different serial column.
  const itemId = firstValue(["Asset Tag"], 0);

  if (!itemId) return null;

  const brand = firstValue(
    ["Brand", "Card Brand", "SD Card Brand"],
    4
  );

  /*
   * MODEL AUTO-FILL:
   * Read the first available value from explicitly named model columns.
   * Never substitute the brand, storage or colour for a missing model.
   */
  const model = firstValue(
    [
      "Model",
      "Model Name",
      "Model No",
      "Model Number",
      "Card Model",
      "Card Model Name",
      "Card Model No",
      "Card Model Number",
      "SD Card Model",
      "SD Card Model Name",
      "SD Card Model No",
      "SD Card Model Number",
    ],
    5
  );

  const prismNo = firstValue(
    ["Prism No", "Prism Number"],
    6
  );

  let capacity = "";

  for (const value of columnValues(
    [
      "Storage",
      "Capacity",
      "Storage Capacity",
      "Card Storage",
      "Storage of Card",
    ],
    2
  )) {
    const normalized = normalizeCapacity(value);

    if (normalized) {
      capacity = normalized;
      break;
    }
  }

  // Your reference tabs are named "256 GB" and "512 GB".
  if (!capacity) {
    capacity = normalizeCapacity(tabCapacity);
  }

  let cardType = "";

  for (const value of columnValues([
    "Card Colour",
    "Card Color",
    "Colour",
    "Color",
    "Card Type",
    "Type of Card",
    "Type of Card / Colour",
    "Type of Card / Color",
  ])) {
    const normalized = normalizeCardType(value);

    if (normalized) {
      cardType = normalized;
      break;
    }
  }

  // Shown on the Add SD card forms; not saved with the card.
  const date = sheetDate(firstValue(["Date", "Purchase Date", "Date of Purchase", "Received Date", "Added Date"]));
  const condition = firstValue(["New/Old", "New / Old", "New or Old", "Old/New", "Condition"]);

  return {
    itemId,
    brand,
    model,
    prismNo,
    capacity,
    cardType,
    date,
    condition,

    // Ignore the source price: apply your fixed penalty rule.
    price: penaltyForCapacity(capacity),
  };
}

/**
 * The sheet is read unformatted, so a date cell arrives as a day number (45730 = 14 Mar 2025).
 * Turn that into "15 Mar 2025"; anything else (text dates) is shown as written.
 */
export function sheetDate(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!/^\d{5}(?:\.\d+)?$/.test(value)) return value;
  const serial = Number(value);
  if (serial < 20000 || serial > 80000) return value;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Find a card by its Asset Tag, ignoring letter case. */
export function findAsset(
  records: AssetRecord[],
  serial: string
): AssetRecord | undefined {
  const normalizedSerial = serial.trim().toLowerCase();

  if (!normalizedSerial) return undefined;

  return records.find(
    (record) =>
      record.itemId.trim().toLowerCase() === normalizedSerial
  );
}
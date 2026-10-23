import type { ReceiptLine } from "./receipt";

/**
 * The item columns on a receipt (web page and PDF), different for each item type:
 *   SD card → Type, Serial, Prism no., Brand / Model, Storage, Colour, Penalty
 *   Rig     → Type, Rig ID / Asset Tag, Brand, Model, Penalty
 *   Mobile  → Type, IMEI, Asset Tag, Serial, Category, Storage, Cost (penalty)
 * The penalty column is last and is filled by the page / PDF (it is the item's saved amount).
 */
export interface ReceiptColumn {
  title: string;
  value: (line: ReceiptLine) => string;
  pdfWidth: number; // points on the A4 PDF
  badge?: boolean; // show the item type badge instead of text (web page)
}

export const RECEIPT_TYPES = ["sd_card", "rig", "mobile"] as const;

export const RECEIPT_TYPE_TITLE: Record<string, string> = { sd_card: "SD cards", rig: "Rigs", mobile: "Mobiles" };

const dash = (v: string) => v.trim() || "—";

export function receiptColumns(type: string): {
  cols: ReceiptColumn[];
  penaltyTitle: string;
  pdfPenaltyTitle?: string; // shorter heading for the narrow PDF column
  penaltyWidth: number;
} {
  if (type === "rig") {
    return {
      cols: [
        { title: "Type", value: () => "Rig", pdfWidth: 44, badge: true },
        { title: "Rig ID / Asset Tag", value: (l) => l.itemId, pdfWidth: 120 },
        { title: "Brand", value: (l) => dash(l.brand), pdfWidth: 90 },
        { title: "Model", value: (l) => dash(l.model), pdfWidth: 110 },
      ],
      penaltyTitle: "Penalty",
      penaltyWidth: 60,
    };
  }
  if (type === "mobile") {
    return {
      cols: [
        { title: "Type", value: () => "Mobile", pdfWidth: 40, badge: true },
        { title: "IMEI", value: (l) => l.itemId, pdfWidth: 84 },
        { title: "Asset Tag", value: (l) => dash(l.assetTag), pdfWidth: 96 },
        { title: "Serial", value: (l) => dash(l.serial), pdfWidth: 66 },
        { title: "Category", value: (l) => dash(l.category), pdfWidth: 62 },
        { title: "Storage", value: (l) => dash(l.storage), pdfWidth: 38 },
      ],
      penaltyTitle: "Cost (penalty)",
      pdfPenaltyTitle: "Cost",
      penaltyWidth: 52,
    };
  }
  return {
    cols: [
      { title: "Type", value: () => "SD card", pdfWidth: 44, badge: true },
      { title: "Serial", value: (l) => l.itemId, pdfWidth: 96 },
      { title: "Prism no.", value: (l) => dash(l.prismNo), pdfWidth: 56 },
      { title: "Brand / Model", value: (l) => dash([l.brand, l.model].filter(Boolean).join(" ")), pdfWidth: 100 },
      { title: "Storage", value: (l) => dash(l.storage), pdfWidth: 44 },
      { title: "Colour", value: (l) => dash(l.cardType), pdfWidth: 40 },
    ],
    penaltyTitle: "Penalty",
    penaltyWidth: 56,
  };
}

/** Items split by type, in the order SD cards, rigs, mobiles; empty types left out. */
export function byReceiptType(lines: ReceiptLine[]): { type: string; lines: ReceiptLine[] }[] {
  return RECEIPT_TYPES.map((type) => ({ type, lines: lines.filter((l) => (l.itemType || "sd_card") === type) })).filter(
    (g) => g.lines.length > 0,
  );
}
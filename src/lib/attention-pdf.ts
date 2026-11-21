import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AttentionReport, DelayedRow } from "./attention";
import { formatIst } from "./time";

type DelayedItem = AttentionReport["delayed"][number];

/** Drops characters pdf-lib's Helvetica can't render (same guard used in receipt-archive.ts). */
function pdfSafe(value: string): string {
  return value.replace(/[^\x00-\xFF]/g, "?");
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  let value = pdfSafe(text);
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  while (value.length > 1 && font.widthOfTextAtSize(`${value}…`, size) > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
}

// Column widths (points), left to right: Type, Person, Role, City, Sent by, Sent on, Issue, Out for, Count.
const COLS: { label: string; width: number }[] = [
  { label: "Type", width: 55 },
  { label: "Person", width: 95 },
  { label: "Role", width: 55 },
  { label: "City", width: 75 },
  { label: "Sent by", width: 95 },
  { label: "Sent on", width: 65 },
  { label: "Issue", width: 80 },
  { label: "Out for", width: 55 },
  { label: "Count", width: 40 },
];

// Detail table columns, left to right: Item ID, Type, Person, Role, City, Sent by, Sent on, Status, Out for.
const DETAIL_COLS: { label: string; width: number }[] = [
  { label: "Item ID", width: 90 },
  { label: "Type", width: 55 },
  { label: "Person", width: 95 },
  { label: "Role", width: 50 },
  { label: "City", width: 70 },
  { label: "Sent by", width: 90 },
  { label: "Sent on", width: 65 },
  { label: "Status", width: 75 },
  { label: "Out for", width: 55 },
];

/**
 * The "Need attention" report as a PDF: one row per delayed-item group (same rows as the /attention
 * page's table), paginated. Modeled on buildReceiptPdf() in receipt-archive.ts (A4 page, Helvetica,
 * fit() for truncation) but a separate, standalone builder — nothing here is shared with or changes
 * the receipt PDF.
 */
export async function buildAttentionPdf(
  rows: DelayedRow[],
  generatedAt: Date,
  byType: Map<string, number>,
  detailItems: DelayedItem[] = [],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Need attention report");
  doc.setAuthor("Instawork");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4: [number, number] = [841.89, 595.28]; // landscape, so the 9-column table fits comfortably
  const margin = 32;
  const contentWidth = A4[0] - margin * 2;
  const rowHeight = 18;
  const headerHeight = 20;

  const black = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.4, 0.4, 0.4);
  const line = rgb(0.85, 0.85, 0.85);
  const headerBg = rgb(0.95, 0.95, 0.96);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - margin;

  const drawTitle = () => {
    page.drawText("Need attention report", { x: margin, y, size: 16, font: bold, color: black });
    y -= 20;
    const total = [...byType.values()].reduce((sum, n) => sum + n, 0);
    const summary =
      total === 0
        ? "Nothing needs attention right now."
        : `${total} item${total === 1 ? "" : "s"} — ${[...byType.entries()].map(([t, c]) => `${c} ${t}${c === 1 ? "" : "s"}`).join(", ")}`;
    page.drawText(fit(summary, regular, 10, contentWidth), { x: margin, y, size: 10, font: regular, color: grey });
    y -= 14;
    page.drawText(`Generated ${formatIst(generatedAt.toISOString())} IST`, { x: margin, y, size: 8.5, font: regular, color: grey });
    y -= 20;
  };

  const drawHeader = () => {
    page.drawRectangle({ x: margin, y: y - headerHeight + 4, width: contentWidth, height: headerHeight, color: headerBg });
    let x = margin + 6;
    for (const col of COLS) {
      page.drawText(col.label, { x, y: y - 13, size: 9, font: bold, color: black });
      x += col.width;
    }
    y -= headerHeight;
    page.drawLine({ start: { x: margin, y }, end: { x: margin + contentWidth, y }, thickness: 0.5, color: line });
  };

  drawTitle();
  drawHeader();

  for (const r of rows) {
    if (y - rowHeight < margin) {
      page = doc.addPage(A4);
      y = A4[1] - margin;
      drawHeader();
    }
    const cells = [r.type, r.person, r.role, r.city, r.sentBy, r.sentOn, r.issue, howLongLabel(r.hours), String(r.count)];
    let x = margin + 6;
    for (let c = 0; c < COLS.length; c++) {
      page.drawText(fit(cells[c], regular, 9, COLS[c].width - 8), { x, y: y - 13, size: 9, font: regular, color: black });
      x += COLS[c].width;
    }
    y -= rowHeight;
    page.drawLine({ start: { x: margin, y }, end: { x: margin + contentWidth, y }, thickness: 0.5, color: line });
  }

  if (rows.length === 0) {
    page.drawText("Nothing needs attention right now.", { x: margin + 6, y: y - 13, size: 10, font: regular, color: grey });
  }

  // ---- Section 2: one row per individual late item (Item ID + Status), not grouped/counted. ----
  if (detailItems.length > 0) {
    page = doc.addPage(A4);
    y = A4[1] - margin;

    page.drawText("Late item details", { x: margin, y, size: 14, font: bold, color: black });
    y -= 18;
    page.drawText(`${detailItems.length} item${detailItems.length === 1 ? "" : "s"}`, {
      x: margin,
      y,
      size: 9.5,
      font: regular,
      color: grey,
    });
    y -= 20;

    const drawDetailHeader = () => {
      page.drawRectangle({ x: margin, y: y - headerHeight + 4, width: contentWidth, height: headerHeight, color: headerBg });
      let x = margin + 6;
      for (const col of DETAIL_COLS) {
        page.drawText(col.label, { x, y: y - 13, size: 9, font: bold, color: black });
        x += col.width;
      }
      y -= headerHeight;
      page.drawLine({ start: { x: margin, y }, end: { x: margin + contentWidth, y }, thickness: 0.5, color: line });
    };

    drawDetailHeader();

    for (const it of detailItems) {
      if (y - rowHeight < margin) {
        page = doc.addPage(A4);
        y = A4[1] - margin;
        drawDetailHeader();
      }
      const cells = [it.id, it.type, it.person, it.role, it.city, it.sentBy, it.sentOn, it.status, howLongLabel(it.hours)];
      let x = margin + 6;
      for (let c = 0; c < DETAIL_COLS.length; c++) {
        page.drawText(fit(cells[c], regular, 9, DETAIL_COLS[c].width - 8), { x, y: y - 13, size: 9, font: regular, color: black });
        x += DETAIL_COLS[c].width;
      }
      y -= rowHeight;
      page.drawLine({ start: { x: margin, y }, end: { x: margin + contentWidth, y }, thickness: 0.5, color: line });
    }
  }

  return doc.save();
}

function howLongLabel(hours: number): string {
  return hours < 48 ? `${Math.floor(hours)} hours` : `${Math.floor(hours / 24)} days`;
}
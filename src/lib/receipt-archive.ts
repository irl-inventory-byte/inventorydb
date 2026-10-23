import { Readable } from "node:stream";
import { google } from "googleapis";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { toBuffer as qrToBuffer } from "qrcode";
import { RECEIPT_TYPE_TITLE, byReceiptType, receiptColumns } from "./receipt-columns";
import { STATUS_LABELS } from "./labels";
import { LOGO_HEIGHT, LOGO_PATHS, LOGO_WIDTH } from "./receipt-logo";
import { formatPrice, summarizeBatch, type BatchSummary } from "./receipt";
import { sendReceiptEmail, type ReceiptEmailResult } from "./receipt-email";
import { getStore } from "./store";
import { formatIst } from "./time";

/**
 * Receipt archive.
 *
 * After a handover is saved, this builds a PDF of the receipt, uploads it to
 * a Google Drive folder and adds one row to the "Receipts" tab of a Google
 * Sheet with a link to the PDF.
 *
 * Settings (Vercel → Project → Settings → Environment Variables):
 *   RECEIPTS_SHEET_ID         spreadsheet that holds the "Receipts" tab
 *   RECEIPTS_DRIVE_FOLDER_ID  Drive folder the PDFs are saved in
 * The defaults below are used when these are not set.
 *
 * The service account (GOOGLE_SERVICE_ACCOUNT_EMAIL) needs Editor access to
 * the spreadsheet, and the folder must be inside a Shared Drive where the
 * service account is a Content manager. Service accounts cannot save files
 * into a normal "My Drive" folder (they have no storage of their own).
 */

const DEFAULT_SHEET_ID = "1VQrdFoSkq4vAp14G8YJkIafuPOHB834Cn0tg3E2yGL0";
const DEFAULT_FOLDER_ID = "1wTvS-vNuAHuVubDaWOsc8A8EN5V3AUDs";
const RECEIPTS_TAB = "Receipts";

const RECEIPT_HEADERS = [
  "Batch ID",
  "Receipt type",
  "Date & time (IST)",
  "From",
  "To",
  "Location",
  "Item count",
  "Serials",
  "Total penalty (Rs.)",
  "Note",
  "Recorded by",
  "Receipt link",
  "PDF",
  "Archived at (IST)",
];

const ACTION_TITLE: Record<string, string> = {
  check_out: "Handover receipt",
  receive: "Receipt confirmation",
  correct: "Correction record",
};

function googleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error(
      "Receipt archive needs GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY."
    );
  }

  return new google.auth.JWT({
    email,
    key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Penalties                                                           */
/* ------------------------------------------------------------------ */

type BatchItem = BatchSummary["items"][number];

// An item that ends this batch back in stock has been returned,
// so nothing is owed for it and its penalty is zero.
function isReturned(item: BatchItem): boolean {
  return STATUS_LABELS[item.statusAfter] === "In stock";
}

function amountOf(raw: string): number {
  const n = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

type PenaltySummary = {
  /** Items that were returned in this batch (penalty is zero for these). */
  returnedCount: number;
  /** Items still with a person that have a valid penalty amount. */
  pricedCount: number;
  /** Items still with a person that have no valid penalty amount. */
  missingPriceCount: number;
  /** Total penalty owed. 0 when everything was returned, null when nothing owed has a price. */
  total: number | null;
};

function penaltySummary(summary: BatchSummary): PenaltySummary {
  const returned = summary.items.filter(isReturned);
  const owed = summary.items.filter((item) => !isReturned(item));
  const priced = owed.filter((item) => formatPrice(item.price) !== "");

  let total: number | null;
  if (owed.length === 0) {
    total = 0;
  } else if (returned.length === 0) {
    // Nothing returned: keep the total exactly as summarizeBatch worked it out.
    total = summary.totalPrice;
  } else if (priced.length === 0) {
    total = null;
  } else {
    total = priced.reduce((sum, item) => sum + amountOf(item.price), 0);
  }

  return {
    returnedCount: returned.length,
    pricedCount: priced.length,
    missingPriceCount: owed.length - priced.length,
    total,
  };
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

// The built-in PDF fonts only cover basic Western characters.
// Replace the rupee sign and drop anything else they cannot draw.
function pdfSafe(text: string): string {
  return text
    .replace(/₹/g, "Rs. ")
    .replace(/[\u202F\u2009\u200A]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\u00A0-\u00FF–—•…]/g, "?");
}

function rupees(raw: string): string {
  return pdfSafe(formatPrice(raw)).trim();
}

function rupeeTotal(total: number | null): string {
  if (total === null) return "Not set";
  if (total === 0) return "Rs. 0";
  return rupees(String(total)) || `Rs. ${total}`;
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number) {
  let value = pdfSafe(text);

  if (font.widthOfTextAtSize(value, size) <= maxWidth) {
    return value;
  }

  while (
    value.length > 1 &&
    font.widthOfTextAtSize(`${value}…`, size) > maxWidth
  ) {
    value = value.slice(0, -1);
  }

  return `${value}…`;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;

    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function hex(color: string) {
  const n = parseInt(color.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function buildReceiptPdf(
  summary: BatchSummary,
  receiptUrl: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${ACTION_TITLE[summary.action] ?? "Batch record"} ${summary.batchId}`);
  doc.setAuthor("Instawork");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4: [number, number] = [595.28, 841.89];
  const margin = 40;
  const contentWidth = A4[0] - margin * 2;

  const black = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.4, 0.4, 0.4);
  const line = rgb(0.85, 0.85, 0.85);

  const penalties = penaltySummary(summary);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - margin;

  const text = (
    value: string,
    x: number,
    size = 10,
    font = regular,
    color = black
  ) => page.drawText(pdfSafe(value), { x, y, size, font, color });

  // Header: logo, title and QR code.
  const logoWidth = 150;
  const logoScale = logoWidth / LOGO_WIDTH;

  for (const p of LOGO_PATHS) {
    if (p.fill === "none") continue;
    page.drawSvgPath(p.d, {
      x: margin,
      y,
      scale: logoScale,
      color: hex(p.fill),
    });
  }

  const qrSize = 110;
  const qrPng = await qrToBuffer(receiptUrl, { type: "png", margin: 1, width: 330 });
  const qrImage = await doc.embedPng(qrPng);
  page.drawImage(qrImage, {
    x: A4[0] - margin - qrSize,
    y: y - qrSize,
    width: qrSize,
    height: qrSize,
  });

  y -= LOGO_HEIGHT * logoScale + 36;
  text(ACTION_TITLE[summary.action] ?? "Batch record", margin, 20, bold);

  y -= 18;
  text(
    `Batch ${summary.batchId} · ${formatIst(summary.occurredAt)} IST`,
    margin,
    10,
    regular,
    grey
  );

  y = Math.min(y, A4[1] - margin - qrSize) - 30;

  // From / To boxes, side by side.
  const ensureSpace = (needed: number, redraw?: () => void) => {
    if (y - needed < margin) {
      page = doc.addPage(A4);
      y = A4[1] - margin;
      redraw?.();
    }
  };

  const boxGap = 14;
  const boxWidth = (contentWidth - boxGap) / 2;
  const boxHeight = 62;

  const partyBox = (
    x: number,
    heading: string,
    person: string,
    location: string
  ) => {
    page.drawRectangle({
      x,
      y: y - boxHeight + 12,
      width: boxWidth,
      height: boxHeight,
      borderColor: line,
      borderWidth: 1,
    });
    const top = y;
    page.drawText(heading, { x: x + 10, y: top, size: 8.5, font: bold, color: grey });
    page.drawText("Person", { x: x + 10, y: top - 17, size: 10, font: regular, color: grey });
    page.drawText(fit(person || "—", bold, 10.5, boxWidth - 80), {
      x: x + 66, y: top - 17, size: 10.5, font: bold, color: black,
    });
    page.drawText("Location", { x: x + 10, y: top - 33, size: 10, font: regular, color: grey });
    page.drawText(fit(location || "—", regular, 10.5, boxWidth - 80), {
      x: x + 66, y: top - 33, size: 10.5, font: regular, color: black,
    });
  };

  partyBox(margin, "FROM", summary.fromName, summary.fromHubName);
  partyBox(margin + boxWidth + boxGap, "TO", summary.toName, summary.hubName);
  y -= boxHeight + 10;

  // Other batch details.
  const storageCounts = new Map<string, number>();
  for (const item of summary.items) {
    const key = item.storage || "Not set";
    storageCounts.set(key, (storageCounts.get(key) ?? 0) + 1);
  }
  const storageBreakdown = [...storageCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([size, count]) => `${size} x ${count}`)
    .join(", ");

  const itemCountLabel = `${summary.items.length} item${summary.items.length === 1 ? "" : "s"}`;

  const facts: [string, string][] = [
    ["Date & time", `${formatIst(summary.occurredAt)} IST`],
    ["Items", storageBreakdown ? `${itemCountLabel} (${storageBreakdown})` : itemCountLabel],
  ];
  if (summary.recordedBy) facts.push(["Recorded by", summary.recordedBy]);
  if (summary.note) facts.push(["Note", summary.note]);

  for (const [label, value] of facts) {
    const lines = wrap(value, regular, 10.5, contentWidth - 90);
    ensureSpace(lines.length * 14 + 6);
    text(label, margin, 10.5, regular, grey);
    lines.forEach((l, i) => {
      if (i > 0) y -= 14;
      text(l, margin + 90, 10.5);
    });
    y -= 17;
  }

  y -= 8;
  // e.g. "5 items" then, when rigs are present, "3 SD cards · 2 Rigs" beside it.
  const rigCount = summary.items.filter((i) => i.itemType === "rig").length;
  const mobileCount = summary.items.filter((i) => i.itemType === "mobile").length;
  const sdCount = summary.items.length - rigCount - mobileCount;
  text(itemCountLabel, margin, 13, bold);
  if (rigCount > 0 || mobileCount > 0) {
    const parts = [
      sdCount ? `${sdCount} SD card${sdCount === 1 ? "" : "s"}` : "",
      rigCount ? `${rigCount} Rig${rigCount === 1 ? "" : "s"}` : "",
      mobileCount ? `${mobileCount} Mobile${mobileCount === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    text(parts.join("  ·  "), margin + bold.widthOfTextAtSize(itemCountLabel, 13) + 14, 10.5, regular, grey);
  }
  y -= 22;

  // Items: one table per item type, each with its own columns (lib/receipt-columns.ts), then the Status.
  // The header repeats on each new page; the total comes once, at the end.
  const drawRow = (cells: string[], widths: number[], font: PDFFont) => {
    let x = margin;
    cells.forEach((cell, i) => {
      text(fit(cell, font, 8.5, widths[i] - 5), x + 2, 8.5, font);
      x += widths[i];
    });
    page.drawLine({
      start: { x: margin, y: y - 6 },
      end: { x: margin + contentWidth, y: y - 6 },
      thickness: 0.6,
      color: line,
    });
    y -= 19;
  };

  const groups = byReceiptType(summary.items);
  let rowNo = 0;
  for (const { type, lines: typeLines } of groups) {
    const { cols, penaltyTitle, pdfPenaltyTitle, penaltyWidth } = receiptColumns(type);
    const used = 20 + cols.reduce((t, c) => t + c.pdfWidth, 0) + penaltyWidth;
    const widths = [20, ...cols.map((c) => c.pdfWidth), penaltyWidth, Math.max(40, contentWidth - used)];
    const header = ["#", ...cols.map((c) => c.title), pdfPenaltyTitle ?? penaltyTitle, "Status"];

    if (groups.length > 1) {
      ensureSpace(60);
      text(`${RECEIPT_TYPE_TITLE[type]} (${typeLines.length})`, margin, 10.5, bold);
      y -= 16;
    }
    ensureSpace(40);
    drawRow(header, widths, bold);

    typeLines.forEach((item) => {
      ensureSpace(24, () => drawRow(header, widths, bold));

      // Rigs get a light orange row so they stand out from SD cards.
      if (item.itemType === "rig") {
        page.drawRectangle({
          x: margin,
          y: y - 6,
          width: contentWidth,
          height: 19,
          color: rgb(1, 0.984, 0.957),
        });
      }

      drawRow(
        [
          String(++rowNo),
          ...cols.map((c) => c.value(item)),
          rupees(item.price) || "Not set",
          STATUS_LABELS[item.statusAfter] ?? item.statusAfter,
        ],
        widths,
        regular
      );
    });
    y -= 6;
  }

  // Summary and total, after the last item.
  const { returnedCount, pricedCount, missingPriceCount } = penalties;

  const totalLabel =
    missingPriceCount > 0 && penalties.total !== null
      ? "Known penalty amounts subtotal"
      : "Total listed penalty amount";
  const totalValue = rupeeTotal(penalties.total);

  y -= 8;
  const sumWidth = 260;
  const sumX = margin + contentWidth - sumWidth;
  const sumHeight = 70 + (returnedCount > 0 ? 16 : 0);
  ensureSpace(sumHeight + 10);

  page.drawRectangle({
    x: sumX,
    y: y - sumHeight + 14,
    width: sumWidth,
    height: sumHeight,
    borderColor: line,
    borderWidth: 1,
  });

  const sumRow = (label: string, value: string, font: PDFFont, size: number, color = black) => {
    page.drawText(pdfSafe(label), { x: sumX + 10, y, size, font, color });
    const v = pdfSafe(value);
    page.drawText(v, {
      x: sumX + sumWidth - 10 - font.widthOfTextAtSize(v, size),
      y,
      size,
      font,
      color: black,
    });
  };

  sumRow("Total items", String(summary.items.length), regular, 10, grey);
  y -= 16;
  if (returnedCount > 0) {
    sumRow("Returned items (no penalty)", String(returnedCount), regular, 10, grey);
    y -= 16;
  }
  sumRow("Items with a penalty amount", String(pricedCount), regular, 10, grey);
  y -= 10;
  page.drawLine({
    start: { x: sumX + 10, y: y + 2 },
    end: { x: sumX + sumWidth - 10, y: y + 2 },
    thickness: 0.6,
    color: line,
  });
  y -= 14;
  sumRow(totalLabel, totalValue, bold, 11);
  y -= 34;

  if (missingPriceCount > 0) {
    const lines = wrap(
      `${missingPriceCount} item${missingPriceCount === 1 ? " has" : "s have"} no valid stored amount. Missing amounts are excluded from the total and must be verified.`,
      regular,
      9,
      contentWidth
    );
    ensureSpace(lines.length * 12 + 8);
    for (const l of lines) {
      text(l, margin, 9, regular, grey);
      y -= 12;
    }
    y -= 8;
  }

  // Responsibility notice, same wording as the on-screen receipt.
  // Left off when every item in the batch was returned, since nothing is owed.
  const allReturned = returnedCount === summary.items.length && summary.items.length > 0;

  if (!allReturned) {
    const notice =
      "IMPORTANT — ITEM RESPONSIBILITY: You are responsible for the safekeeping and timely return of the items listed on this receipt. Any loss or damage must be reported immediately. If you are found responsible following review, the applicable penalty may be deducted from your salary, subject to company policy, any required consent, and applicable law. The listed amounts are not an automatic charge.";

    const noticeLines = wrap(notice, bold, 9.5, contentWidth - 24);
    const noticeHeight = noticeLines.length * 14 + 16;
    ensureSpace(noticeHeight + 8);

    page.drawRectangle({
      x: margin,
      y: y - noticeHeight + 12,
      width: contentWidth,
      height: noticeHeight,
      color: rgb(1, 0.97, 0.97),
      borderColor: rgb(0.73, 0.11, 0.11),
      borderWidth: 1,
    });

    y -= 4;
    for (const l of noticeLines) {
      text(l, margin + 12, 9.5, bold, rgb(0.6, 0.11, 0.11));
      y -= 14;
    }
  }

  // Footer on every page: receipt link and page number.
  const pages = doc.getPages();
  pages.forEach((p: PDFPage, i: number) => {
    p.drawText(fit(`Receipt link: ${receiptUrl}`, regular, 7.5, contentWidth - 60), {
      x: margin, y: 22, size: 7.5, font: regular, color: grey,
    });
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, {
      x: margin + contentWidth - regular.widthOfTextAtSize(label, 7.5),
      y: 22, size: 7.5, font: regular, color: grey,
    });
  });

  return doc.save();
}

/* ------------------------------------------------------------------ */
/* Drive + Sheet                                                       */
/* ------------------------------------------------------------------ */

// Stop text typed by users from being read as a spreadsheet formula.
function cell(value: string | number): string | number {
  if (typeof value === "number") return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

async function ensureReceiptsTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });

  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === RECEIPTS_TAB
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: RECEIPTS_TAB } } }],
      },
    });
  }

  const head = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${RECEIPTS_TAB}'!A1:A1`,
  });

  if (!head.data.values?.[0]?.[0]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${RECEIPTS_TAB}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [RECEIPT_HEADERS] },
    });
  }
}

/**
 * Build the receipt PDF for one batch, save it to Drive and log it in the
 * "Receipts" tab. Errors are logged and never thrown, so a Drive or Sheets
 * problem can never undo or block a handover that was already saved.
 */
export async function archiveReceipt(batchId: string, baseUrl: string) {
  try {
    await saveReceipt(batchId, baseUrl);
  } catch (error) {
    console.error(`[receipt-archive] Could not archive batch ${batchId}:`, error);
  }
}

/**
 * Same as archiveReceipt, but throws a readable error naming the step that
 * failed. Used by the admin test page at /api/receipt-test.
 */
export async function saveReceipt(batchId: string, baseUrl: string) {
  let step = "reading the batch";
  try {
    const store = getStore();
    const [events, items, hubs] = await Promise.all([
      store.list("events"),
      store.list("items"),
      store.list("hubs"),
    ]);

    const summary = summarizeBatch(events, items, hubs, batchId);
    if (!summary) {
      throw new Error(`Batch ${batchId} not found in the events tab.`);
    }

    const penalties = penaltySummary(summary);

    const receiptUrl = `${baseUrl}/handover/receipt/${encodeURIComponent(batchId)}`;
    step = "building the PDF";
    const pdf = await buildReceiptPdf(summary, receiptUrl);

    step = "signing in to Google";
    const auth = googleAuth();
    const drive = google.drive({ version: "v3", auth });
    const sheets = google.sheets({ version: "v4", auth });

    const folderId = process.env.RECEIPTS_DRIVE_FOLDER_ID || DEFAULT_FOLDER_ID;
    const spreadsheetId = process.env.RECEIPTS_SHEET_ID || DEFAULT_SHEET_ID;

    // File name: "<person receiving the items> - <date> - <batch>.pdf",
    // e.g. "Aryyaneel Saikia - 08 Oct 2026 - b-737e2401.pdf".
    // The batch ID keeps names unique when one person gets several receipts on the same day.
    const personName =
      (summary.toName || "Unknown")
        .replace(/[\\/:*?"<>|#%]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "Unknown";

    const occurred = Date.parse(summary.occurredAt);
    const datePart = Number.isNaN(occurred)
      ? summary.occurredAt.slice(0, 10)
      : new Date(occurred).toLocaleDateString("en-GB", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
        });

    const fileName = `${personName} - ${datePart} - ${batchId}.pdf`;

    step = `uploading the PDF to Drive folder ${folderId}`;
    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        mimeType: "application/pdf",
      },
      media: {
        mimeType: "application/pdf",
        body: Readable.from(Buffer.from(pdf)),
      },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });

    const pdfLink =
      uploaded.data.webViewLink ??
      `https://drive.google.com/file/d/${uploaded.data.id}/view`;

    step = `opening the Receipts tab in sheet ${spreadsheetId}`;
    await ensureReceiptsTab(sheets, spreadsheetId);

    const firstEvent = events.find((e) => e.batch_id === batchId);

    step = "adding the row to the Receipts tab";
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${RECEIPTS_TAB}'!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [
          [
            cell(batchId),
            cell(ACTION_TITLE[summary.action] ?? summary.action),
            cell(formatIst(summary.occurredAt)),
            cell(summary.fromName),
            cell(summary.toName),
            cell(summary.hubName),
            summary.items.length,
            cell(summary.items.map((i) => i.itemId).join(", ")),
            penalties.total ?? "",
            cell(summary.note),
            cell(firstEvent?.recorded_by ?? ""),
            `=HYPERLINK("${receiptUrl}", "Open receipt")`,
            `=HYPERLINK("${pdfLink}", "${fileName.replace(/"/g, "")}")`,
            cell(formatIst(new Date().toISOString())),
          ],
        ],
      },
    });

    // Email the PDF to the person who sent the items and the person who received them.
    step = "emailing the receipt to the From and To person";
    const email: ReceiptEmailResult = await sendReceiptEmail({
      summary,
      title: ACTION_TITLE[summary.action] ?? "Batch record",
      pdf,
      fileName,
      receiptUrl,
      totalPenalty: rupeeTotal(penalties.total),
    });

    if (email.missing.length > 0) {
      console.warn(
        `[receipt-archive] No email found for ${email.missing.join(", ")} (batch ${batchId}).`
      );
    }

    return {
      fileName,
      pdfLink,
      emailedTo: email.sentTo,
      noEmailFor: email.missing,
      peopleTab: email.tab || "not found",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed while ${step}: ${message}`);
  }
}
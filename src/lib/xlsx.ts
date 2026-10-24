import { deflateRawSync } from "node:zlib";

/**
 * A small Excel (.xlsx) writer with no extra packages.
 *
 * Each sheet gets a bold header row that stays on screen when scrolling,
 * filter arrows on every column, and sensible column widths.
 * Cells can be text, numbers, dates (shown as "14-Oct-2026 10:15") or
 * rupee amounts (shown as "₹1,500.00").
 */

export type Cell =
  | string
  | number
  | null
  | undefined
  | { date: Date }
  | { rupees: number };

export interface SheetData {
  name: string;
  header: string[];
  rows: Cell[][];
}

// Style numbers in styles.xml below.
const STYLE_HEADER = 1;
const STYLE_DATE = 2;
const STYLE_RUPEES = 3;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Remove characters XML can't hold, then escape the rest. */
function esc(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnLetter(n: number): string {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  }
  return s;
}

/** Excel's day number for an instant, in India time. */
const excelDate = (d: Date) => (d.getTime() + IST_OFFSET_MS) / 86_400_000 + 25569;

function cellXml(ref: string, cell: Cell, style = 0): string {
  const s = style ? ` s="${style}"` : "";
  if (cell === null || cell === undefined || cell === "") return "";
  if (typeof cell === "number") {
    return Number.isFinite(cell) ? `<c r="${ref}"${s}><v>${cell}</v></c>` : "";
  }
  if (typeof cell === "object" && "date" in cell) {
    const t = cell.date.getTime();
    return Number.isNaN(t) ? "" : `<c r="${ref}" s="${STYLE_DATE}"><v>${excelDate(cell.date)}</v></c>`;
  }
  if (typeof cell === "object" && "rupees" in cell) {
    return Number.isFinite(cell.rupees)
      ? `<c r="${ref}" s="${STYLE_RUPEES}"><v>${cell.rupees}</v></c>`
      : "";
  }
  const text = String(cell).slice(0, 32767);
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

/** Rough on-screen width of a cell, for the column widths. */
function cellWidth(cell: Cell): number {
  if (cell === null || cell === undefined) return 0;
  if (typeof cell === "object" && "date" in cell) return 18;
  if (typeof cell === "object" && "rupees" in cell) return 14;
  return Math.max(...String(cell).split("\n").map((line) => line.length));
}

function sheetXml(sheet: SheetData): string {
  const cols = sheet.header.length;
  const widths = sheet.header.map((h, c) =>
    Math.min(
      60,
      Math.max(8, cellWidth(h) + 2, ...sheet.rows.slice(0, 2000).map((r) => cellWidth(r[c]) + 2))
    )
  );

  const rowsXml = [sheet.header as Cell[], ...sheet.rows]
    .map((row, r) => {
      const cells = row
        .slice(0, cols)
        .map((cell, c) => cellXml(`${columnLetter(c + 1)}${r + 1}`, cell, r === 0 ? STYLE_HEADER : 0))
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  const last = `${columnLetter(Math.max(1, cols))}${sheet.rows.length + 1}`;

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0">` +
    `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
    `</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${rowsXml}</sheetData>` +
    (cols ? `<autoFilter ref="A1:${last}"/>` : "") +
    `</worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="2">` +
  `<numFmt numFmtId="164" formatCode="dd\\-mmm\\-yyyy hh:mm"/>` +
  `<numFmt numFmtId="165" formatCode="&quot;₹&quot;#,##0.00"/>` +
  `</numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill>` +
  `<fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFE6EEFF"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** A sheet name Excel accepts: no []:*?/\, at most 31 characters, unique. */
function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = raw.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Build an .xlsx file from one or more sheets. */
export function buildXlsx(sheets: SheetData[]): Buffer {
  const list = sheets.length ? sheets : [{ name: "Sheet1", header: [], rows: [] }];
  const names = sheetNames(list.map((s) => s.name));

  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        list
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join("") +
        `</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${names
          .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("")}</sheets>` +
        `<definedNames>${list
          .map((s, i) =>
            s.header.length
              ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(
                  names[i].replace(/'/g, "''")
                )}'!$A$1:$${columnLetter(s.header.length)}$${s.rows.length + 1}</definedName>`
              : ""
          )
          .join("")}</definedNames>` +
        `</workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        list
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
          )
          .join("") +
        `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ],
    ["xl/styles.xml", STYLES],
    ...list.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)] as [string, string]),
  ];

  return zip(files.map(([name, text]) => [name, Buffer.from(text, "utf8")]));
}

// ---- Minimal ZIP writer (deflate) -------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries: [string, Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, ...centrals, end]);
}
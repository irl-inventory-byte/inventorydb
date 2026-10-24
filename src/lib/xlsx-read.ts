import { inflateRawSync } from "node:zlib";

/**
 * A small Excel (.xlsx) READER with no extra packages, for the one-time Supabase copy from a downloaded
 * Google Sheet (File → Download → Microsoft Excel). The writer is in xlsx.ts.
 *
 * Every cell comes back as the text the app would have read from Google:
 *   - text as is (the app writes everything as plain text, so almost every cell is text);
 *   - whole numbers as plain digits (a typed mobile number stays 9876543210, never 9.88E+09);
 *   - dates/times someone typed into the sheet as an India-time timestamp, 2026-09-25T19:14:54+05:30,
 *     the same format the app writes;
 *   - TRUE / FALSE as true / false; a formula as its last calculated value.
 */

export interface XlsxSheet {
  name: string;
  /** Rows of cells, row 0 is the first row of the tab. Missing cells are "". */
  values: string[][];
  /** How many date/time cells were turned into timestamps (typed by hand in the sheet). */
  datesConverted: number;
}

// ---- zip ------------------------------------------------------------------------------------------

function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This is not an .xlsx file (no zip directory found).");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Damaged .xlsx file (bad zip entry).");
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, inflateRawSync(data));
    else throw new Error(`Unsupported compression in .xlsx (${name}).`);
  }
  return files;
}

// ---- xml helpers ----------------------------------------------------------------------------------

function unescape(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
      const l = e.toLowerCase();
      if (l === "amp") return "&";
      if (l === "lt") return "<";
      if (l === "gt") return ">";
      if (l === "quot") return '"';
      if (l === "apos") return "'";
      return String.fromCodePoint(l.startsWith("#x") ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
    })
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

const attr = (tag: string, name: string): string | undefined => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unescape(m[1]) : undefined;
};

/** All the text of <t> elements inside a piece of xml (rich text has several). */
function texts(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += unescape(m[1]);
  return out;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ---- dates and numbers ----------------------------------------------------------------------------

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(code: string): boolean {
  // Drop quoted text, escaped characters and [colour]/[$-…] parts, then look for date/time letters.
  const plain = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "");
  return /[dmyhs]/i.test(plain) && !/^[#0.,%\s]*$/.test(plain);
}

/** Excel day number (in India time, like the sheet) → 2026-09-25T19:14:54+05:30. */
function serialToIst(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000); // as if the clock time were UTC
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+05:30`
  );
}

function numberText(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (Number.isInteger(n)) return BigInt(Math.round(n)).toString(); // no 9.87E+09
  return String(Number(n.toPrecision(15))); // drop float noise like 0.30000000000000004
}

// ---- workbook -------------------------------------------------------------------------------------

export function readXlsx(file: Buffer): XlsxSheet[] {
  const zip = unzip(file);
  const get = (path: string) => zip.get(path)?.toString("utf8");

  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new Error("This .xlsx file has no workbook inside.");

  // Sheet name → file, via the relationships file.
  const rels = new Map<string, string>();
  for (const m of (get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) {
      rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
    }
  }

  // Shared strings (most text cells point into this list).
  const shared: string[] = [];
  for (const m of (get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));

  // Which cell styles are dates.
  const styles = get("xl/styles.xml") ?? "";
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\s[^>]*>/g)) {
    custom.set(Number(attr(m[0], "numFmtId")), attr(m[0], "formatCode") ?? "");
  }
  const dateStyle: boolean[] = [];
  const xfs = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  for (const m of xfs.matchAll(/<xf\s[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    dateStyle.push(BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!)));
  }

  const sheets: XlsxSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], "name") ?? "";
    const rid = attr(m[0], "r:id");
    const xml = rid ? get(rels.get(rid) ?? "") : undefined;
    if (!xml) continue;

    const values: string[][] = [];
    let datesConverted = 0;
    let nextRow = 0;
    for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = attr(row[0].slice(0, row[0].indexOf(">") + 1), "r");
      const ri = r ? Number(r) - 1 : nextRow;
      nextRow = ri + 1;
      const cells: string[] = [];
      let nextCol = 0;
      for (const c of (row[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const open = `<c${c[1]}>`;
        const ref = attr(open, "r");
        const ci = ref ? colIndex(ref) : nextCol;
        nextCol = ci + 1;
        const t = attr(open, "t") ?? "n";
        const body = c[2] ?? "";
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];

        let text = "";
        if (t === "s") text = v === undefined ? "" : (shared[Number(v)] ?? "");
        else if (t === "inlineStr") text = texts(body);
        else if (t === "str" || t === "e") text = v === undefined ? "" : unescape(v);
        else if (t === "b") text = v === "1" ? "true" : v === "0" ? "false" : "";
        else if (t === "d") text = v === undefined ? "" : unescape(v);
        else if (v !== undefined) {
          if (dateStyle[Number(attr(open, "s") ?? 0)]) {
            text = serialToIst(Number(v));
            datesConverted++;
          } else {
            text = numberText(v);
          }
        }
        while (cells.length < ci) cells.push("");
        cells[ci] = text;
      }
      while (values.length < ri) values.push([]);
      values[ri] = cells;
    }
    sheets.push({ name, values, datesConverted });
  }
  return sheets;
}

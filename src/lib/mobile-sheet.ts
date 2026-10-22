import { google } from "googleapis";

/**
 * Read-only reference sheet for MOBILES (like the rig sheet for rigs).
 *
 * Settings (Vercel → Environment Variables), both optional:
 *   MOBILE_SHEET_ID   the mobile sheet's ID (default below)
 *   MOBILE_SHEET_TAB  tab to read (default: the tab in the sheet link, gid 1052519988, else the first tab)
 *
 * Share the sheet with GOOGLE_SERVICE_ACCOUNT_EMAIL as Viewer.
 *
 * Columns are matched by the header text in row 1, ignoring case, spaces and dots:
 *   IMEI          → any heading with "IMEI" in it (IMEI, IMEI 1, IMEI 2 …): a phone matches any of them
 *   Asset Tag, Serial, Model, Model No., Category, Manufacturer, Storage, Cost
 */

const DEFAULT_MOBILE_SHEET_ID = "1htZCwR4v7Vdz27P0Rs3ehOzxwwHpfqP_HWu8_KS1L7k";
const DEFAULT_TAB_GID = 1052519988;
const TTL_MS = 5 * 60 * 1000;

export interface MobileRecord {
  imei: string; // the first IMEI, digits only
  imeis: string[]; // every IMEI on the row, digits only
  assetTag: string;
  serial: string;
  model: string;
  modelNo: string;
  category: string;
  manufacturer: string;
  storage: string;
  cost: string; // digits only, "" when missing
}

const key = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");
const onlyDigits = (raw: string) => String(raw ?? "").replace(/[^0-9]/g, "");

const HEADERS: Record<Exclude<keyof MobileRecord, "imei" | "imeis">, string[]> = {
  assetTag: ["assettag", "assettagno", "assetid", "assetno"],
  serial: ["serial", "serialno", "serialnumber"],
  model: ["model", "modelname"],
  modelNo: ["modelno", "modelnumber"],
  category: ["category", "type"],
  manufacturer: ["manufacturer", "make", "brand"],
  storage: ["storage", "capacity", "rom"],
  cost: ["cost", "price", "value", "amount"],
};

function money(raw: string): string {
  const cleaned = String(raw ?? "").replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) && n > 0 ? String(Math.round(n)) : "";
}

/**
 * The IMEI numbers in what the scanner typed. A phone's QR code may hold just the number, or text such as
 * "IMEI1: 351234567890123, IMEI2: …". Every run of 14 to 17 digits counts.
 */
export function imeisIn(scanned: string): string[] {
  const runs = String(scanned ?? "").match(/\d{14,17}/g) ?? [];
  if (runs.length) return [...new Set(runs)];
  const all = onlyDigits(scanned);
  return all.length >= 14 ? [all] : [];
}

/** Turn the sheet's rows (row 1 = headers) into mobile records. Pure, for testing. */
export function parseMobileRows(rows: string[][]): MobileRecord[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h ?? "").trim());
  const keys = headers.map(key);

  const imeiCols = keys.map((k, i) => (k.includes("imei") ? i : -1)).filter((i) => i !== -1);
  if (imeiCols.length === 0) {
    throw new Error(`The mobile sheet needs an "IMEI" column in row 1. Found: ${headers.join(", ") || "(empty)"}`);
  }
  const col = (wanted: string[]) => {
    for (const w of wanted) {
      const at = keys.indexOf(w);
      if (at !== -1) return at;
    }
    return -1;
  };
  const at = Object.fromEntries(Object.entries(HEADERS).map(([field, names]) => [field, col(names)])) as Record<
    keyof typeof HEADERS,
    number
  >;

  const records: MobileRecord[] = [];
  for (const row of rows.slice(1)) {
    const cell = (i: number) => (i === -1 ? "" : String(row[i] ?? "").trim());
    const imeis = imeiCols.map((i) => onlyDigits(cell(i))).filter((d) => d.length >= 14);
    if (imeis.length === 0) continue;
    records.push({
      imei: imeis[0],
      imeis,
      assetTag: cell(at.assetTag),
      serial: cell(at.serial),
      model: cell(at.model),
      modelNo: cell(at.modelNo),
      category: cell(at.category),
      manufacturer: cell(at.manufacturer),
      storage: cell(at.storage),
      cost: money(cell(at.cost)),
    });
  }
  return records;
}

/** Find a phone by any IMEI in what was scanned. */
export function findMobile(records: MobileRecord[], scanned: string): MobileRecord | undefined {
  const wanted = imeisIn(scanned);
  if (wanted.length === 0) return undefined;
  return records.find((r) => r.imeis.some((i) => wanted.includes(i)));
}

/** The details saved with a mobile (shown on its page and searchable in Inventory). */
export function mobileAttributes(r: Pick<MobileRecord, "assetTag" | "serial" | "modelNo" | "category" | "storage">): string {
  const pairs: [string, string][] = [
    ["Asset Tag", r.assetTag],
    ["Serial", r.serial],
    ["Model No.", r.modelNo],
    ["Category", r.category],
    ["Storage", r.storage],
  ];
  const kept = pairs.filter(([, v]) => v.trim());
  return kept.length ? JSON.stringify(Object.fromEntries(kept.map(([k, v]) => [k, v.trim()]))) : "";
}

export const mobileSheetId = () => process.env.MOBILE_SHEET_ID || DEFAULT_MOBILE_SHEET_ID;

/** A plain-words reason why the mobile sheet could not be read, for the Add a mobile form. */
export function mobileSheetError(error: unknown): string {
  const e = error as { code?: number; status?: number; message?: string; response?: { status?: number } };
  const status = e?.response?.status ?? e?.status ?? e?.code;
  const message = String(e?.message ?? error ?? "");
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "(GOOGLE_SERVICE_ACCOUNT_EMAIL is not set in Vercel)";

  if (status === 403 || /permission|forbidden/i.test(message)) {
    return `No access to the mobile sheet. Share it with ${email} as Viewer.`;
  }
  if (status === 404 || /not found|Requested entity was not found/i.test(message)) {
    return `Mobile sheet not found (ID ${mobileSheetId()}). Check MOBILE_SHEET_ID in Vercel, or delete it to use the default.`;
  }
  if (/Unable to parse range/i.test(message)) {
    return "The tab named in MOBILE_SHEET_TAB does not exist in the mobile sheet. Fix or delete MOBILE_SHEET_TAB in Vercel.";
  }
  if (/private key|DECODER|invalid_grant|No key or keyFile/i.test(message)) {
    return "The app's Google login is not working. Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in Vercel.";
  }
  return `Could not read the mobile sheet: ${message.slice(0, 200)}`;
}

let cache: { records: MobileRecord[]; at: number; id: string } | null = null;

export async function loadMobileRecords(): Promise<MobileRecord[]> {
  const spreadsheetId = mobileSheetId();
  if (cache && cache.id === spreadsheetId && Date.now() - cache.at < TTL_MS) return cache.records;

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const api = google.sheets({ version: "v4", auth });

  let tab = process.env.MOBILE_SHEET_TAB ?? "";
  if (!tab) {
    const meta = await api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" });
    const tabs = meta.data.sheets ?? [];
    const linked = tabs.find((s) => s.properties?.sheetId === DEFAULT_TAB_GID);
    tab = (linked ?? tabs[0])?.properties?.title ?? "Sheet1";
  }

  // Unformatted, so a long IMEI stored as a number is not shown as 3.51E+14.
  const result = await api.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab.replace(/'/g, "''")}'!A1:AZ`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const rows = (result.data.values ?? []).map((row) => row.map((v) => String(v ?? "")));
  const records = parseMobileRows(rows);
  cache = { records, at: Date.now(), id: spreadsheetId };
  return records;
}
import { google } from "googleapis";

/**
 * Read-only reference sheet for POWER BANKS (like the mobile sheet for mobiles).
 *
 * Settings (Vercel → Environment Variables), both optional:
 *   POWER_BANK_SHEET_ID   the power bank sheet's ID (default below)
 *   POWER_BANK_SHEET_TAB  tab to read (default: the tab in the sheet link, gid 0, else the first tab)
 *
 * Share the sheet with GOOGLE_SERVICE_ACCOUNT_EMAIL as Viewer.
 *
 * Columns are matched by their heading, ignoring case, spaces and dots. The heading row is the first row
 * (of the first 10) that has an "Asset Tag" heading, so title rows above the table are fine:
 *   Asset Tag, Date, Type, Brand, Model, Color, Capacity, Output, Price/Penalty
 */

const DEFAULT_POWER_BANK_SHEET_ID = "1gQxy-hzaoU7oja_yp5eSHTyajUr6UX-bgXyWIL82mNE";
const DEFAULT_TAB_GID = 0;
const TTL_MS = 5 * 60 * 1000;
// If Google's API hangs (bad network, bad credentials that don't fail fast, …) with no timeout here,
// the Add Power Bank form's "busy" state never clears and the Save button stays silently disabled
// forever — this bounds that so the form always gets back a note, one way or another, within 8s.
const SHEET_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out ${what} (over ${ms / 1000}s).`)), ms)),
  ]);
}

export interface PowerBankRecord {
  assetTag: string;
  date: string;
  type: string;
  brand: string;
  model: string;
  color: string;
  capacity: string;
  output: string;
  price: string; // digits only, "" when missing
}

const key = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADERS: Record<Exclude<keyof PowerBankRecord, "assetTag">, string[]> = {
  date: ["date"],
  type: ["type"],
  brand: ["brand", "make", "manufacturer"],
  model: ["model", "modelname"],
  color: ["color", "colour"],
  capacity: ["capacity", "mah", "capacitymah"],
  output: ["output", "outputw", "wattage"],
  price: ["pricepenalty", "price", "penalty", "cost", "amount", "value"],
};

const ASSET_TAG_HEADINGS = ["assettag", "assettagno", "assetid", "assetno"];

function money(raw: string): string {
  const cleaned = String(raw ?? "").replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) && n > 0 ? String(Math.round(n)) : "";
}

/** What was read from the power bank sheet, shown when a power bank is not found. */
export interface PowerBankSheetInfo {
  tab: string;
  powerBanks: number;
}

/** Turn the sheet's rows into power bank records. Pure, for testing. */
export function parsePowerBankRows(rows: string[][]): PowerBankRecord[] {
  return parsePowerBankSheet(rows).records;
}

export function parsePowerBankSheet(rows: string[][]): { records: PowerBankRecord[] } {
  // The heading row: the first of the top 10 rows with an "Asset Tag" heading.
  const headAt = rows.slice(0, 10).findIndex((r) => r.some((h) => ASSET_TAG_HEADINGS.includes(key(String(h ?? "")))));
  if (headAt === -1) {
    const first = (rows[0] ?? []).map((h) => String(h ?? "").trim()).filter(Boolean);
    throw new Error(`The power bank sheet needs an "Asset Tag" column heading. Row 1 has: ${first.join(", ") || "(empty)"}`);
  }
  const headers = rows[headAt].map((h) => String(h ?? "").trim());
  const keys = headers.map(key);

  const assetTagCol = keys.findIndex((k) => ASSET_TAG_HEADINGS.includes(k));
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

  const records: PowerBankRecord[] = [];
  for (const row of rows.slice(headAt + 1)) {
    const cell = (i: number) => (i === -1 ? "" : String(row[i] ?? "").trim());
    const assetTag = cell(assetTagCol);
    if (!assetTag) continue;
    records.push({
      assetTag,
      date: cell(at.date),
      type: cell(at.type) || "Power Bank",
      brand: cell(at.brand),
      model: cell(at.model),
      color: cell(at.color),
      capacity: cell(at.capacity),
      output: cell(at.output),
      price: money(cell(at.price)),
    });
  }
  return { records };
}

const plain = (v: string) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");

/** Find a power bank by what was scanned or typed: its Asset Tag (letter case and spaces ignored). */
export function findPowerBank(records: PowerBankRecord[], scanned: string): PowerBankRecord | undefined {
  const text = plain(scanned);
  if (!text) return undefined;
  return records.find((r) => plain(r.assetTag) === text);
}

/** The details saved with a power bank (shown on its page and searchable in Inventory). */
export function powerBankAttributes(r: Pick<PowerBankRecord, "color" | "capacity" | "output" | "date">): string {
  const pairs: [string, string][] = [
    ["color", r.color],
    ["capacity", r.capacity],
    ["output", r.output],
    ["date", r.date],
  ];
  const kept = pairs.filter(([, v]) => v.trim());
  return kept.length ? JSON.stringify(Object.fromEntries(kept.map(([k, v]) => [k, v.trim()]))) : "";
}

export const powerBankSheetId = () => process.env.POWER_BANK_SHEET_ID || DEFAULT_POWER_BANK_SHEET_ID;

/** A plain-words reason why the power bank sheet could not be read, for the Add a power bank form. */
export function powerBankSheetError(error: unknown): string {
  const e = error as { code?: number; status?: number; message?: string; response?: { status?: number } };
  const status = e?.response?.status ?? e?.status ?? e?.code;
  const message = String(e?.message ?? error ?? "");
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "(GOOGLE_SERVICE_ACCOUNT_EMAIL is not set in Vercel)";

  if (status === 403 || /permission|forbidden/i.test(message)) {
    return `No access to the power bank sheet. Share it with ${email} as Viewer.`;
  }
  if (status === 404 || /not found|Requested entity was not found/i.test(message)) {
    return `Power bank sheet not found (ID ${powerBankSheetId()}). Check POWER_BANK_SHEET_ID in Vercel, or delete it to use the default.`;
  }
  if (/Unable to parse range/i.test(message)) {
    return "The tab named in POWER_BANK_SHEET_TAB does not exist in the power bank sheet. Fix or delete POWER_BANK_SHEET_TAB in Vercel.";
  }
  if (/private key|DECODER|invalid_grant|No key or keyFile/i.test(message)) {
    return "The app's Google login is not working. Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in Vercel.";
  }
  return `Could not read the power bank sheet: ${message.slice(0, 200)}`;
}

let cache: { records: PowerBankRecord[]; info: PowerBankSheetInfo; at: number; id: string } | null = null;

export async function loadPowerBankRecords(): Promise<PowerBankRecord[]> {
  return (await loadPowerBankSheet()).records;
}

/** The power banks in the sheet, and where they were read from. */
export async function loadPowerBankSheet(): Promise<{ records: PowerBankRecord[]; info: PowerBankSheetInfo }> {
  const spreadsheetId = powerBankSheetId();
  if (cache && cache.id === spreadsheetId && Date.now() - cache.at < TTL_MS) return cache;

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const api = google.sheets({ version: "v4", auth });

  let tab = process.env.POWER_BANK_SHEET_TAB ?? "";
  if (!tab) {
    const meta = await withTimeout(
      api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties(sheetId,title)" }),
      SHEET_TIMEOUT_MS,
      "reading the power bank sheet's tab list",
    );
    const tabs = meta.data.sheets ?? [];
    const linked = tabs.find((s) => s.properties?.sheetId === DEFAULT_TAB_GID);
    tab = (linked ?? tabs[0])?.properties?.title ?? "Sheet1";
  }

  const result = await withTimeout(
    api.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tab.replace(/'/g, "''")}'!A1:AZ`,
      valueRenderOption: "UNFORMATTED_VALUE",
    }),
    SHEET_TIMEOUT_MS,
    "reading the power bank sheet",
  );
  const rows = (result.data.values ?? []).map((row) => row.map((v) => String(v ?? "")));
  const { records } = parsePowerBankSheet(rows);
  cache = { records, info: { tab, powerBanks: records.length }, at: Date.now(), id: spreadsheetId };
  return cache;
}
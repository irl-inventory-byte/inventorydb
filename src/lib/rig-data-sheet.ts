import { google } from "googleapis";
import { getStore } from "@/lib/store";

/**
 * Writes the matching Productivity-team SD card serial into the "Rig Data" Google Sheet, matched by
 * Date + City + IC — live from Supabase, no manual CSV export/import.
 *
 * Settings (Vercel → Environment Variables), both optional:
 *   RIG_DATA_SHEET_ID   the Rig Data sheet's ID (default below, from the link you shared)
 *   RIG_DATA_SHEET_TAB  tab name (default: "Rig Data")
 *
 * Share the sheet with GOOGLE_SERVICE_ACCOUNT_EMAIL as EDITOR (not just Viewer) — this writes a column
 * into it, unlike the read-only sheets elsewhere in this app (power-bank-sheet.ts, etc.).
 */

const DEFAULT_RIG_DATA_SHEET_ID = "1m31Qt1STTSEVmxv8OvXzx0wlvvGnTGM1BJADMXXg6dw";
const DEFAULT_TAB = "Rig Data";
const SHEET_TIMEOUT_MS = 15000;

const sheetId = () => process.env.RIG_DATA_SHEET_ID || DEFAULT_RIG_DATA_SHEET_ID;
const tabName = () => process.env.RIG_DATA_SHEET_TAB || DEFAULT_TAB;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timed out ${what} (over ${ms / 1000}s).`)), ms)),
  ]);
}

function sheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    // Read-WRITE scope — the read-only sheets elsewhere in this app use spreadsheets.readonly, but
    // writing the matched serial back into the sheet needs the full scope.
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

/** "01/09/26" (dd/mm/yy, as the Rig Data sheet has it) -> "2026-09-01" (as sd_card_durations.card_date has it). */
function rigDateToCardDate(raw: string): string {
  const m = String(raw ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  const [, dd, mm, yy] = m;
  const year = yy.length === 2 ? `20${yy}` : yy;
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

const normCity = (v: string) => String(v ?? "").trim().toLowerCase();
const normIc = (v: string) => String(v ?? "").trim().toUpperCase();
const matchKey = (date: string, city: string, ic: string) => `${date}|${normCity(city)}|${normIc(ic)}`;

export interface SyncResult {
  matched: number;
  notFound: number;
  rows: number;
  column: string; // the sheet column letter that was written, e.g. "G"
}

/**
 * Reads the Rig Data sheet and the Productivity team's sd_card_durations, matches each sheet row to
 * a serial by Date + City + IC, and writes the result into a "Productivity SD Serial" column in the
 * sheet (added at the end of the existing columns if it isn't there yet, reused if it is).
 */
export async function syncProductivitySerialsToRigSheet(): Promise<SyncResult> {
  const api = sheetsClient();
  const id = sheetId();
  const tab = tabName();

  const sheetResp = await withTimeout(
    api.spreadsheets.values.get({
      spreadsheetId: id,
      range: `'${tab.replace(/'/g, "''")}'!A1:Z`,
      valueRenderOption: "UNFORMATTED_VALUE",
    }),
    SHEET_TIMEOUT_MS,
    "reading the Rig Data sheet",
  );
  const grid = (sheetResp.data.values ?? []).map((row) => row.map((v) => String(v ?? "")));
  if (grid.length < 1) throw new Error(`The "${tab}" tab is empty.`);

  const header = grid[0];
  const dateCol = header.findIndex((h) => h.trim().toLowerCase() === "date");
  const cityCol = header.findIndex((h) => h.trim().toLowerCase() === "city");
  const icCol = header.findIndex((h) => h.trim().toLowerCase().includes("tracker") && h.trim().toLowerCase().includes("ic"));
  if (dateCol === -1 || cityCol === -1 || icCol === -1) {
    throw new Error(`Couldn't find "Date", "City" and "Tracker Rig IC" columns in row 1 of "${tab}". Found: ${header.join(", ")}`);
  }

  // Reuse the "Productivity SD Serial" column if it already exists; otherwise add it right after the
  // last existing column.
  const OUT_HEADER = "Productivity SD Serial";
  let outCol = header.findIndex((h) => h.trim() === OUT_HEADER);
  if (outCol === -1) outCol = header.length;
  const outColLetter = columnLetter(outCol);

  // Every Productivity-team SD card entry, keyed by Date + City + IC (see matchKey above).
  const all = await getStore().list("sd_card_durations");
  const bySerial = new Map<string, string>();
  for (const r of all) {
    if (r.team !== "rig") continue;
    if (!r.card_date || !r.city || !r.ic_name) continue;
    bySerial.set(matchKey(r.card_date, r.city, r.ic_name), r.serial || "");
  }

  let matched = 0;
  let notFound = 0;
  const out: string[][] = [[OUT_HEADER]];
  for (const row of grid.slice(1)) {
    const cardDate = rigDateToCardDate(row[dateCol] ?? "");
    const city = row[cityCol] ?? "";
    const ic = row[icCol] ?? "";
    if (!cardDate || !city || !ic) {
      out.push([""]);
      continue;
    }
    const serial = bySerial.get(matchKey(cardDate, city, ic));
    if (serial) {
      matched++;
      out.push([serial]);
    } else {
      notFound++;
      out.push(["Not found"]);
    }
  }

  await withTimeout(
    api.spreadsheets.values.update({
      spreadsheetId: id,
      range: `'${tab.replace(/'/g, "''")}'!${outColLetter}1:${outColLetter}${out.length}`,
      valueInputOption: "RAW",
      requestBody: { values: out },
    }),
    SHEET_TIMEOUT_MS,
    "writing serials back to the Rig Data sheet",
  );

  return { matched, notFound, rows: grid.length - 1, column: outColLetter };
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA", … */
function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}
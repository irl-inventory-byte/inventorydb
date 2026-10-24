import { google } from "googleapis";
import { parseAssetRow, type AssetRecord } from "./asset-lookup";

/**
 * Read-only reference sheet for SD CARDS (like the rig and mobile sheets). It is read live, so rows
 * people add to the sheet show up in Add a card within a few minutes (TTL_MS).
 * This is separate from the application's inventory database.
 *
 * Settings (Vercel → Environment Variables), all optional:
 *   ASSET_SHEET_ID    the SD card sheet's ID (default below)
 *   ASSET_SHEET_TABS  tabs to read, comma separated, e.g. "512 GB, 256 GB"
 *                     (default: every tab with an "Asset Tag" heading in row 1)
 *
 * Share the sheet with GOOGLE_SERVICE_ACCOUNT_EMAIL as Viewer.
 * A tab named like a storage size ("512 GB", "256 GB") also gives its cards that storage.
 */

const DEFAULT_ASSET_SHEET_ID = "1F2zgaWRgG6WejOJoux-ZFrjkK6xodWoy08Gwdo2-EDI";
const TTL_MS = 5 * 60 * 1000;

/** The SD card sheet ID in use (the ASSET_SHEET_ID setting, or the default). */
export const assetSheetId = () => process.env.ASSET_SHEET_ID || DEFAULT_ASSET_SHEET_ID;

const isAssetTag = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "") === "assettag";
const quote = (tab: string) => `'${tab.replace(/'/g, "''")}'`;

/** A plain-words reason why the SD card sheet could not be read, for the Add a card forms. */
export function assetSheetError(error: unknown): string {
  const e = error as { code?: number; status?: number; message?: string; response?: { status?: number } };
  const status = e?.response?.status ?? e?.status ?? e?.code;
  const message = String(e?.message ?? error ?? "");
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "(GOOGLE_SERVICE_ACCOUNT_EMAIL is not set in Vercel)";

  if (status === 403 || /permission|forbidden/i.test(message)) {
    return `No access to the SD card sheet. Share it with ${email} as Viewer.`;
  }
  if (status === 404 || /not found|Requested entity was not found/i.test(message)) {
    return `SD card sheet not found (ID ${assetSheetId()}). Check ASSET_SHEET_ID in Vercel, or delete it to use the default.`;
  }
  if (/Unable to parse range/i.test(message)) {
    return "A tab named in ASSET_SHEET_TABS does not exist in the SD card sheet. Fix or delete ASSET_SHEET_TABS in Vercel.";
  }
  if (/has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
    return "The Google Sheets API is turned off for the service account's Google Cloud project. Turn it on, then try again.";
  }
  if (/private key|DECODER|invalid_grant|No key or keyFile|client_email/i.test(message)) {
    return "The app's Google login is not working. Check GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in Vercel.";
  }
  // "No tab has an Asset Tag heading" and similar already read clearly.
  return `Could not read the SD card sheet: ${message.slice(0, 200)}`;
}

/** Turn one tab's rows into records. Row 1 must have an "Asset Tag" heading. */
export function parseAssetTab(tab: string, rows: string[][]): AssetRecord[] {
  if (rows.length === 0) return [];
  const headers = rows[0];
  if (!headers.some(isAssetTag)) {
    throw new Error(`The "${tab}" tab of the SD card sheet needs an "Asset Tag" heading in row 1.`);
  }
  const records: AssetRecord[] = [];
  for (const row of rows.slice(1)) {
    const record = parseAssetRow(row, tab, headers);
    if (record) records.push(record);
  }
  return records;
}

let cache: { records: AssetRecord[]; at: number; spreadsheetId: string } | null = null;

export async function loadAssetRecords(): Promise<AssetRecord[]> {
  const spreadsheetId = assetSheetId();

  if (cache && cache.spreadsheetId === spreadsheetId && Date.now() - cache.at < TTL_MS) {
    return cache.records;
  }

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const api = google.sheets({ version: "v4", auth });

  const pinned = (process.env.ASSET_SHEET_TABS ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  let tabs = pinned;
  if (!tabs.length) {
    // Every tab, then keep the ones whose row 1 has an Asset Tag heading.
    const meta = await api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
    const all = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
    const heads = await api.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: all.map((t) => `${quote(t)}!1:1`),
    });
    tabs = all.filter((_, i) => (heads.data.valueRanges?.[i]?.values?.[0] ?? []).some((h) => isAssetTag(String(h))));
    if (!tabs.length) {
      throw new Error(
        `No tab of the SD card sheet has an "Asset Tag" heading in row 1 (tabs: ${all.join(", ") || "none"}).`,
      );
    }
  }

  // Read each tab separately so one missing or broken tab does not stop lookups in the others.
  // Unformatted, so a long number is not shown as 3.51E+14.
  const settled = await Promise.allSettled(
    tabs.map(async (tab) => {
      const result = await api.spreadsheets.values.get({
        spreadsheetId,
        range: `${quote(tab)}!A1:AZ`,
        valueRenderOption: "UNFORMATTED_VALUE",
      });
      return parseAssetTab(tab, (result.data.values ?? []).map((row) => row.map((v) => String(v ?? ""))));
    }),
  );

  const failures: string[] = [];
  const results: AssetRecord[][] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") results.push(outcome.value);
    else {
      const reason = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      failures.push(`"${tabs[index]}" tab: ${reason}`);
    }
  });

  if (failures.length) console.error(`[asset-sheet] ${failures.join(" | ")}`);

  // Every tab failed: give the first real error (it carries the status code) to the caller.
  if (results.length === 0) {
    const first = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    throw first?.reason ?? new Error(failures.join(" | "));
  }

  const records = results.flat();
  cache = { records, at: Date.now(), spreadsheetId };
  return records;
}

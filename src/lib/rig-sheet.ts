import { google } from "googleapis";

/**
 * Read-only reference sheet for RIGS (like the asset sheet for SD cards).
 *
 * Settings (Vercel → Environment Variables):
 *   RIG_SHEET_ID   the rig sheet's ID (default below)
 *   RIG_SHEET_TAB  tab to read (default: the first tab)
 *
 * Share the sheet with GOOGLE_SERVICE_ACCOUNT_EMAIL as Viewer.
 *
 * Columns are matched by the header text in row 1, ignoring case and spaces:
 *   ID      → "Asset Tag", "Asset ID", "Rig ID", "Rig No", "Rig", "Serial", "Serial No", "ID"
 *   Brand   → "Brand", "Make", "Manufacturer"
 *   Model   → "Model", "Rig Model", "Model Name", "Model No"
 *   Prism   → "Prism", "Prism No", "Prism Number"
 *   Penalty → "Penalty", "Penalty Amount", "Price", "Cost", "Value", "Amount"
 * Every other column is kept and shown as a detail of the rig.
 */

const DEFAULT_RIG_SHEET_ID = "18AtMF3kPGccxoBMKBzgSoyBalX-x9E_EYPFrtm7ttZU";
const TTL_MS = 5 * 60 * 1000;

const ID_HEADERS = [
  "assettag", "assettagno", "assetid", "assetno", "rigid", "rigno", "rignumber", "rig",
  "serial", "serialno", "serialnumber", "id",
];
const BRAND_HEADERS = ["brand", "make", "manufacturer"];
const MODEL_HEADERS = ["model", "rigmodel", "modelname", "modelno"];
const PRISM_HEADERS = ["prism", "prismno", "prismnumber"];
const PENALTY_HEADERS = ["penalty", "penaltyamount", "penaltyamountrs", "price", "cost", "value", "amount"];

export interface RigRecord {
  rigId: string;
  brand: string;
  model: string;
  prismNo: string;
  penalty: string; // digits only, "" when missing
  details: [string, string][]; // every other column: [header, value]
}

const key = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

function digits(raw: string): string {
  const cleaned = String(raw ?? "").replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return cleaned && Number.isFinite(n) && n > 0 ? String(Math.round(n)) : "";
}

/** Turn the sheet's rows (row 1 = headers) into rig records. Pure, for testing. */
export function parseRigRows(rows: string[][]): RigRecord[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => String(h ?? "").trim());
  const keys = headers.map(key);

  const find = (wanted: string[]) => {
    for (const w of wanted) {
      const at = keys.indexOf(w);
      if (at !== -1) return at;
    }
    return -1;
  };

  const idCol = find(ID_HEADERS);
  if (idCol === -1) {
    throw new Error(
      `The rig sheet needs an ID column in row 1, named one of: Asset Tag, Rig ID, Serial, ID. Found: ${headers.join(", ") || "(empty)"}`
    );
  }
  const brandCol = find(BRAND_HEADERS);
  const modelCol = find(MODEL_HEADERS);
  const prismCol = find(PRISM_HEADERS);
  const penaltyCol = find(PENALTY_HEADERS);
  const used = new Set([idCol, brandCol, modelCol, prismCol, penaltyCol]);

  const records: RigRecord[] = [];
  for (const row of rows.slice(1)) {
    const cell = (i: number) => (i === -1 ? "" : String(row[i] ?? "").trim());
    const rigId = cell(idCol);
    if (!rigId) continue;

    records.push({
      rigId,
      brand: cell(brandCol),
      model: cell(modelCol),
      prismNo: cell(prismCol),
      penalty: digits(cell(penaltyCol)),
      details: headers
        .map((h, i) => [h, cell(i)] as [string, string])
        .filter(([h, v], i) => h && v && !used.has(i)),
    });
  }
  return records;
}

let cache: { records: RigRecord[]; at: number; id: string } | null = null;

export async function loadRigRecords(): Promise<RigRecord[]> {
  const spreadsheetId = process.env.RIG_SHEET_ID || DEFAULT_RIG_SHEET_ID;

  if (cache && cache.id === spreadsheetId && Date.now() - cache.at < TTL_MS) {
    return cache.records;
  }

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const api = google.sheets({ version: "v4", auth });

  let tab = process.env.RIG_SHEET_TAB ?? "";
  if (!tab) {
    const meta = await api.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    tab = meta.data.sheets?.[0]?.properties?.title ?? "Sheet1";
  }

  const result = await api.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab.replace(/'/g, "''")}'!A1:Z`,
    valueRenderOption: "FORMATTED_VALUE",
  });

  const rows = (result.data.values ?? []).map((row) => row.map((v) => String(v ?? "")));
  const records = parseRigRows(rows);
  cache = { records, at: Date.now(), id: spreadsheetId };
  return records;
}

/** Find a rig by its ID, ignoring letter case and spaces at the ends. */
export function findRig(records: RigRecord[], rigId: string): RigRecord | undefined {
  const wanted = rigId.trim().toLowerCase();
  if (!wanted) return undefined;
  return records.find((r) => r.rigId.trim().toLowerCase() === wanted);
}
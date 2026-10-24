/**
 * ONE-TIME COPY: Google Sheet → Supabase, including ALL history (events, QC checks, hardware updates,
 * rig reports, receipt edits, deletions).
 *
 *   npm run migrate:supabase                 copy every tab, then check every row arrived
 *   npm run migrate:supabase -- --dry-run    only read the sheet and report, write nothing
 *   npm run migrate:supabase -- --force      copy even if Supabase already has rows
 *   npm run migrate:supabase -- --file inventory.xlsx
 *                                            read a downloaded copy of the sheet instead of Google
 *                                            (Google Sheets → File → Download → Microsoft Excel)
 *
 * Needs in .env.local: SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY (Supabase),
 * and, only when reading Google directly (no --file): SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL,
 * GOOGLE_PRIVATE_KEY.
 *
 * How history is kept safe:
 *   - Columns are matched by their HEADING, so a moved column cannot put values in the wrong field.
 *   - Rows are copied in sheet order, so "oldest first" stays the same.
 *   - In history tabs no row is dropped: exact copies are kept once; different rows that share an ID are
 *     all kept, the extra ones under "<id>~2", "<id>~3"… (see src/lib/migrate-plan.ts).
 *   - After copying, every ID in the sheet is checked to be in Supabase.
 *
 * Safe to run again before go-live: rows are matched on their ID, so nothing is doubled.
 * After go-live do NOT run it again: it would overwrite newer Supabase data with the old sheet.
 */
import { readFileSync } from "node:fs";
import { TABS, type Row, type TabName } from "../src/lib/schema";
import {
  cleanCardType,
  dedupe,
  foldColumnIntoAttributes,
  HISTORY_TABS,
  rowsFromSheet,
} from "../src/lib/migrate-plan";
import { SupabaseBackend } from "../src/lib/store/supabase";
import { readXlsx } from "../src/lib/xlsx-read";

const argv = process.argv.slice(2);
const args = new Set(argv);
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const wantsFile = argv.some((a) => a === "--file" || a.startsWith("--file="));
const file = wantsFile
  ? (argv.find((a) => a.startsWith("--file="))?.slice(7) ?? argv[argv.indexOf("--file") + 1] ?? "")
  : undefined;
if (wantsFile && (!file || file.startsWith("--"))) {
  console.error("Give the downloaded file after --file, e.g.  npm run migrate:supabase -- --file inventory.xlsx");
  process.exit(1);
}

const need = (name: string, value: string | undefined): string => {
  if (!value) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
  return value as string;
};

const supa = new SupabaseBackend({
  url: need("SUPABASE_URL", process.env.SUPABASE_URL),
  key: need(
    "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)",
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  ),
});

/** Google limits reads per minute: wait and retry on 429 / short 5xx. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const waits = [2000, 5000, 15000, 30000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const e = err as { code?: number | string; status?: number; response?: { status?: number } };
      const status = Number(e.response?.status ?? e.status ?? e.code);
      if (![429, 500, 502, 503].includes(status) || attempt >= waits.length) throw err;
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

/** Where the sheet's data comes from: a downloaded .xlsx, or Google directly. */
interface Source {
  tabs: Set<string>;
  values(tab: string): Promise<unknown[][]>;
}

async function fileSource(path: string): Promise<Source> {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    console.error(`Cannot open ${path}. Check the file name and folder.`);
    process.exit(1);
  }
  let book: ReturnType<typeof readXlsx> = [];
  try {
    book = readXlsx(buf!);
  } catch (e) {
    console.error(`${path}: ${(e as Error).message}\nDownload it again with File → Download → Microsoft Excel (.xlsx).`);
    process.exit(1);
  }
  const byName = new Map(book.map((s) => [s.name, s]));
  for (const s of book) {
    if (s.datesConverted && s.name in TABS) {
      notes.push(`${s.name}: ${s.datesConverted} date cell(s) typed by hand in the sheet, copied as India-time timestamps.`);
    }
  }
  return { tabs: new Set(byName.keys()), values: async (tab) => byName.get(tab)?.values ?? [] };
}

async function googleSource(): Promise<Source> {
  const { google } = await import("googleapis");
  const spreadsheetId = need("SHEET_ID", process.env.SHEET_ID);
  const sheets = google.sheets({
    version: "v4",
    auth: new google.auth.JWT({
      email: need("GOOGLE_SERVICE_ACCOUNT_EMAIL", process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
      key: need("GOOGLE_PRIVATE_KEY", process.env.GOOGLE_PRIVATE_KEY).replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    }),
  });
  const meta = await withRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" }),
  );
  return {
    tabs: new Set((meta.data.sheets ?? []).map((s) => s.properties?.title ?? "")),
    values: async (tab) => {
      const res = await withRetry(() => sheets.spreadsheets.values.get({ spreadsheetId, range: tab }));
      return (res.data.values ?? []) as unknown[][];
    },
  };
}

const notes: string[] = [];
const source = file ? await fileSource(file) : await googleSource();
// Which tabs exist in the sheet (a tab the app never created simply has no rows).
const sheetTabs = source.tabs;
if (file && ![...sheetTabs].some((t) => t in TABS)) {
  console.error(
    `${file} has none of the app's tabs (items, events, people …). Found: ${[...sheetTabs].join(", ") || "nothing"}.\n` +
      "Download the inventory sheet itself: File → Download → Microsoft Excel (.xlsx).",
  );
  process.exit(1);
}

// items first, so events can keep the ID that items point to as their last event.
const tabs = (Object.keys(TABS) as TabName[]).sort((a, b) => (a === "items" ? -1 : b === "items" ? 1 : 0));

const from = file ? `${file}` : "Google Sheet";
console.log(dryRun ? `DRY RUN: reading ${from} only, nothing is written.\n` : `Copying ${from} → Supabase.\n`);

if (!dryRun) {
  // Stops here with a clear message if setup.sql was not run.
  await supa.ensureTabs();

  // Guard against overwriting live Supabase data with an old sheet.
  if (!force) {
    const filled: string[] = [];
    for (const tab of tabs) {
      const n = (await supa.readAll(tab)).length;
      if (n > 0) filled.push(`${tab} (${n})`);
    }
    if (filled.length) {
      console.error(
        `Supabase already has data in: ${filled.join(", ")}.\n` +
          "If you are still BEFORE go-live and want to copy again, run:  npm run migrate:supabase -- --force\n" +
          "If the app already runs on Supabase, do NOT copy again.",
      );
      process.exit(1);
    }
  }
}

let problems = 0;
const report: string[] = [];
const lastEventOf = new Map<string, string>(); // item_id → last_event_id
let historyRows = 0;

for (const tab of tabs) {
  const columns = TABS[tab];
  const key = columns[0];

  if (!sheetTabs.has(tab)) {
    report.push(`${tab.padEnd(17)} not in the sheet, nothing to copy`);
    continue;
  }

  const raw = await source.values(tab);
  const read = rowsFromSheet(raw, columns);

  // A "Card Type" column on items: the app keeps card colour in attributes.card_type, so move it there
  // (only where attributes has none) instead of dropping it.
  if (tab === "items" && read.unknownColumns.some((h) => h.trim().toLowerCase() === "card type")) {
    const fold = foldColumnIntoAttributes(raw, read.rows, key, "Card Type", "card_type", cleanCardType);
    read.unknownColumns = read.unknownColumns.filter((h) => h.trim().toLowerCase() !== "card type");
    notes.push(
      `items: "Card Type" column moved into each card's details: ${fold.filled} filled in, ${fold.same} already the same` +
        (fold.differed.length
          ? `, ${fold.differed.length} different from the app's value (app's value kept): ${fold.differed.slice(0, 8).join(", ")}${fold.differed.length > 8 ? " …" : ""}`
          : "") +
        ".",
    );
  }

  // An Excel cell holds at most 32,767 characters (Google Sheets: 50,000), so a downloaded file cuts
  // longer cells. A cut photo is a broken image, so it is left blank; other cut cells are kept and listed.
  if (file) {
    const cut: string[] = [];
    for (const r of read.rows) {
      for (const c of columns) {
        if ((r[c] ?? "").length < 32_767) continue;
        cut.push(`${r[key]} (${c})`);
        if (c === "photo") r[c] = "";
      }
    }
    if (cut.length) {
      notes.push(
        `${tab}: ${cut.length} cell(s) were longer than an Excel cell allows and were cut in the download` +
          `${columns.includes("photo" as never) ? " (photos left blank)" : ""}: ${cut.slice(0, 8).join(", ")}${cut.length > 8 ? " …" : ""}. ` +
          "Copy these from the Google Sheet by hand if you need them.",
      );
    }
  }

  if (read.unknownColumns.length) {
    problems++;
    notes.push(
      `${tab}: the sheet has column(s) the app does not use, NOT copied: ${read.unknownColumns.join(", ")}. ` +
        "If that data matters, tell your developer before switching.",
    );
  }
  if (read.missingColumns.length) {
    notes.push(`${tab}: no heading for ${read.missingColumns.join(", ")} (older sheet), copied as blank.`);
  }

  if (tab === "items") for (const r of read.rows) lastEventOf.set(r.item_id, r.last_event_id);

  const plan = dedupe(
    tab,
    read.rows,
    key,
    tab === "events"
      ? (r: Row) => lastEventOf.get(r.item_id) === r.event_id
      : tab === "users"
        ? (r: Row) => r.active !== "false" // the row the app signs this login in with today
        : undefined,
  );
  if (plan.renamed.length) {
    notes.push(
      `${tab}: ${plan.renamed.length} row(s) shared an ID with a different row; all kept, new IDs: ` +
        plan.renamed.slice(0, 8).map((x) => `${x.from}→${x.to}`).join(", ") +
        (plan.renamed.length > 8 ? " …" : ""),
    );
  }
  if (plan.exactCopies) notes.push(`${tab}: ${plan.exactCopies} exact duplicate row(s) kept once.`);
  if (plan.replaced.length) {
    notes.push(
      `${tab}: ${plan.replaced.length} ID(s) appear more than once, ` +
        (tab === "users" ? "the first active row (the one the app uses today) was kept: " : "the last row was kept: ") +
        plan.replaced.slice(0, 8).join(", ") +
        (plan.replaced.length > 8 ? " …" : ""),
    );
  }
  if (HISTORY_TABS.has(tab)) historyRows += plan.rows.length;

  if (!dryRun) await supa.upsert(tab, plan.rows);

  let line = `${tab.padEnd(17)} sheet ${String(read.rows.length).padStart(7)}  → copy ${String(plan.rows.length).padStart(7)}`;
  if (!dryRun) {
    const inSupabase = await supa.readAll(tab);
    const there = new Set(inSupabase.map((r) => r[key]));
    const lost = plan.rows.filter((r) => !there.has(r[key])).map((r) => r[key]);
    const ok = lost.length === 0 && inSupabase.length === plan.rows.length;
    if (!ok) {
      problems++;
      if (lost.length) notes.push(`${tab}: NOT in Supabase after copy: ${lost.slice(0, 10).join(", ")}`);
    }
    line += `  → Supabase ${String(inSupabase.length).padStart(7)}  ${ok ? "✓" : "✗ MISMATCH"}`;
  }
  report.push(line);
}

console.log(report.join("\n"));
if (notes.length) console.log("\nNotes:\n- " + notes.join("\n- "));
console.log(`\nHistory rows (events, QC, hardware, rig reports, receipt edits, deletions): ${historyRows}`);
console.log(
  dryRun
    ? "\nDry run finished. Nothing was written."
    : problems
      ? `\n${problems} problem(s) above. Do not switch yet; send this output to your developer.`
      : "\nAll tables copied and every row checked. Next: test with STORE=supabase, then switch Vercel.",
);
process.exit(problems ? 1 : 0);

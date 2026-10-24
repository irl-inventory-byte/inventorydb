/**
 * ONE-TIME COPY: Google Sheet → Supabase, including ALL history (events, QC checks, hardware updates,
 * rig reports, receipt edits, deletions).
 *
 *   npm run migrate:supabase                 copy every tab, then check every row arrived
 *   npm run migrate:supabase -- --dry-run    only read the sheet and report, write nothing
 *   npm run migrate:supabase -- --force      copy even if Supabase already has rows
 *
 * Needs in .env.local: SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY (the sheet)
 * and SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY (Supabase).
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
import { google } from "googleapis";
import { TABS, type Row, type TabName } from "../src/lib/schema";
import { dedupe, HISTORY_TABS, rowsFromSheet } from "../src/lib/migrate-plan";
import { SupabaseBackend } from "../src/lib/store/supabase";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");

const need = (name: string, value: string | undefined): string => {
  if (!value) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
  return value as string;
};

const spreadsheetId = need("SHEET_ID", process.env.SHEET_ID);
const sheets = google.sheets({
  version: "v4",
  auth: new google.auth.JWT({
    email: need("GOOGLE_SERVICE_ACCOUNT_EMAIL", process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
    key: need("GOOGLE_PRIVATE_KEY", process.env.GOOGLE_PRIVATE_KEY).replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  }),
});
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

// Which tabs exist in the sheet (a tab the app never created simply has no rows).
const meta = await withRetry(() =>
  sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" }),
);
const sheetTabs = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title ?? ""));

// items first, so events can keep the ID that items point to as their last event.
const tabs = (Object.keys(TABS) as TabName[]).sort((a, b) => (a === "items" ? -1 : b === "items" ? 1 : 0));

console.log(dryRun ? "DRY RUN: reading only, nothing is written.\n" : "Copying Google Sheet → Supabase.\n");

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
const notes: string[] = [];
const lastEventOf = new Map<string, string>(); // item_id → last_event_id
let historyRows = 0;

for (const tab of tabs) {
  const columns = TABS[tab];
  const key = columns[0];

  if (!sheetTabs.has(tab)) {
    report.push(`${tab.padEnd(17)} not in the sheet, nothing to copy`);
    continue;
  }

  const res = await withRetry(() => sheets.spreadsheets.values.get({ spreadsheetId, range: tab }));
  const read = rowsFromSheet((res.data.values ?? []) as unknown[][], columns);

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
    tab === "events" ? (r: Row) => lastEventOf.get(r.item_id) === r.event_id : undefined,
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
      `${tab}: ${plan.replaced.length} ID(s) appear more than once, the last row was kept: ` +
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

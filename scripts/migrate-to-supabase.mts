/**
 * ONE-TIME COPY: Google Sheet → Supabase.
 *
 *   npm run migrate:supabase                 copy every tab, then check the counts
 *   npm run migrate:supabase -- --dry-run    only read the sheet and report, write nothing
 *   npm run migrate:supabase -- --force      copy even if Supabase already has rows
 *
 * Needs in .env.local: SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY (the sheet)
 * and SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY (Supabase).
 *
 * Safe to run again before go-live: rows are matched on their ID, so nothing is doubled.
 * After go-live do NOT run it again: it would overwrite newer Supabase data with the old sheet.
 */
import { TABS, type Row, type TabName } from "../src/lib/schema";
import { SheetsBackend } from "../src/lib/store/sheets";
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

const sheet = new SheetsBackend({
  spreadsheetId: need("SHEET_ID", process.env.SHEET_ID),
  clientEmail: need("GOOGLE_SERVICE_ACCOUNT_EMAIL", process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL),
  privateKey: need("GOOGLE_PRIVATE_KEY", process.env.GOOGLE_PRIVATE_KEY),
});
const supa = new SupabaseBackend({
  url: need("SUPABASE_URL", process.env.SUPABASE_URL),
  key: need(
    "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)",
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  ),
});

const tabs = Object.keys(TABS) as TabName[];

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

for (const tab of tabs) {
  const key = TABS[tab][0];
  let rows: Row[] = [];
  try {
    rows = await sheet.readAll(tab);
  } catch (e) {
    // A tab that was never created in the sheet simply has no rows.
    report.push(`${tab.padEnd(17)} tab not found in the sheet, skipped`);
    continue;
  }

  // Same ID more than once: keep the LAST row (the sheet's newest), and list them.
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r[key], (seen.get(r[key]) ?? 0) + 1);
  const dupes = [...seen.entries()].filter(([, c]) => c > 1).map(([id]) => id);
  const unique = new Map<string, Row>();
  for (const r of rows) {
    unique.delete(r[key]);
    unique.set(r[key], r);
  }
  const toCopy = [...unique.values()];

  if (!dryRun) await supa.upsert(tab, toCopy);

  let line = `${tab.padEnd(17)} sheet ${String(rows.length).padStart(7)}`;
  if (dupes.length) {
    line += `  (${dupes.length} duplicate ID${dupes.length === 1 ? "" : "s"}, last kept: ${dupes.slice(0, 5).join(", ")}${dupes.length > 5 ? " …" : ""})`;
  }
  if (!dryRun) {
    const inSupabase = (await supa.readAll(tab)).length;
    const ok = inSupabase === toCopy.length;
    if (!ok) problems++;
    line += `  →  Supabase ${String(inSupabase).padStart(7)}  ${ok ? "✓" : "✗ MISMATCH"}`;
  }
  report.push(line);
}

console.log(report.join("\n"));
console.log(
  dryRun
    ? "\nDry run finished. Nothing was written."
    : problems
      ? `\n${problems} table(s) do not match. Do not switch yet; send this output to your developer.`
      : "\nAll tables copied and checked. Next: test with STORE=supabase, then switch Vercel.",
);
process.exit(problems ? 1 : 0);

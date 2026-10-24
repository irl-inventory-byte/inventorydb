/**
 * Check the three lookup sheets that Add item reads live from Google:
 *
 *   npm run check:sheets
 *
 * For each one it says how many rows it found, or the reason it could not read the sheet and what to fix.
 * Needs GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in .env.local, and each sheet shared with that
 * email as Viewer. The inventory itself can be in Supabase; these sheets stay in Google.
 */
import { assetSheetError, assetSheetId, loadAssetRecords } from "../src/lib/asset-sheet";
import { loadMobileSheet, mobileSheetError, mobileSheetId } from "../src/lib/mobile-sheet";
import { loadRigRecords, rigSheetError, rigSheetId } from "../src/lib/rig-sheet";

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
if (!email || !process.env.GOOGLE_PRIVATE_KEY) {
  console.error(
    "GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set in .env.local to read the lookup sheets.",
  );
  process.exit(1);
}
console.log(`Reading the lookup sheets as ${email}\n`);

const link = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;
let failed = 0;

async function check(name: string, id: string, load: () => Promise<string>, explain: (e: unknown) => string) {
  try {
    console.log(`✓ ${name.padEnd(9)} ${await load()}`);
  } catch (error) {
    failed++;
    console.log(`✗ ${name.padEnd(9)} ${explain(error)}\n  ${link(id)}`);
  }
}

await check(
  "SD cards",
  assetSheetId(),
  async () => `${(await loadAssetRecords()).length} cards`,
  assetSheetError,
);
await check(
  "Mobiles",
  mobileSheetId(),
  async () => {
    const { records, info } = await loadMobileSheet();
    return `${records.length} phones (tab "${info.tab}", IMEI columns: ${info.imeiHeadings.join(", ") || "none"})`;
  },
  mobileSheetError,
);
await check("Rigs", rigSheetId(), async () => `${(await loadRigRecords()).length} rigs`, rigSheetError);

console.log(failed ? `\n${failed} sheet(s) could not be read. Fix the reason shown, then run this again.` : "\nAll lookup sheets are readable.");
process.exit(failed ? 1 : 0);

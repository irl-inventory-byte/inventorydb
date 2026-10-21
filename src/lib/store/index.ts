import { CachedBackend } from "./cached";
import { MemoryBackend } from "./memory";
import { SheetsBackend } from "./sheets";
import { Store } from "./store";

export { Store } from "./store";

function create(): Store {
  if (process.env.STORE === "sheets") {
    const { SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
    if (!SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
      throw new Error(
        "STORE=sheets needs SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY",
      );
    }
    // CachedBackend: each tab is downloaded once and reused for a few seconds, so a page or a send does
    // not hit Google's per-minute read limit (see cached.ts).
    return new Store(
      new CachedBackend(
        new SheetsBackend({
          spreadsheetId: SHEET_ID,
          clientEmail: GOOGLE_SERVICE_ACCOUNT_EMAIL,
          privateKey: GOOGLE_PRIVATE_KEY,
        }),
      ),
    );
  }
  return new Store(new MemoryBackend());
}

// One store per server process, kept across hot reloads in development.
const g = globalThis as unknown as { __store?: Store };

export function getStore(): Store {
  return (g.__store ??= create());
}
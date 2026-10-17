import { MemoryBackend } from "./memory";
import { SheetsBackend } from "./sheets";
import { SupabaseBackend } from "./supabase";
import { Store } from "./store";

export { Store } from "./store";

function create(): Store {
  if (process.env.STORE === "supabase") {
    // The secret key: SUPABASE_SERVICE_ROLE_KEY (old-style) or SUPABASE_SECRET_KEY (new sb_secret_… key).
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      throw new Error("STORE=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)");
    }
    return new Store(new SupabaseBackend({ url, key }));
  }
  if (process.env.STORE === "sheets") {
    const { SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
    if (!SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
      throw new Error(
        "STORE=sheets needs SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY",
      );
    }
    return new Store(
      new SheetsBackend({
        spreadsheetId: SHEET_ID,
        clientEmail: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        privateKey: GOOGLE_PRIVATE_KEY,
      }),
    );
  }
  return new Store(new MemoryBackend());
}

// One store per server process, kept across hot reloads in development.
const g = globalThis as unknown as { __store?: Store };

export function getStore(): Store {
  return (g.__store ??= create());
}
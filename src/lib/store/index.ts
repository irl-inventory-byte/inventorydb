
import { MemoryBackend } from "./memory";
import { SheetsBackend } from "./sheets";
import { SupabaseBackend } from "./supabase";
import { Store } from "./store";

export { Store } from "./store";

/** The Supabase backend, from SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. */
export function supabaseBackend(): SupabaseBackend {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return new SupabaseBackend({
    url: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  });
}

/** The Google Sheets backend, from SHEET_ID and the service account. */
export function sheetsBackend(): SheetsBackend {
  const { SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  if (!SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    throw new Error(
      "Google Sheets needs SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY",
    );
  }
  return new SheetsBackend({
    spreadsheetId: SHEET_ID,
    clientEmail: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: GOOGLE_PRIVATE_KEY,
  });
}

function create(): Store {
  if (process.env.STORE === "supabase") {
    return new Store(supabaseBackend());
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

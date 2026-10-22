/** The IMEI-like numbers (14 to 17 digits) in a scanned line, e.g. a phone QR code "IMEI1 - IMEI2". */
export const imeiRuns = (code: string): string[] => String(code ?? "").match(/\d{14,17}/g) ?? [];

/**
 * Merges ticked ids with scanned/pasted text (one serial per line), trimmed and de-duplicated.
 * A line with an IMEI in it (a phone QR code, e.g. "356… - 357…") is kept whole: it is one phone.
 */
export function collectIds(scanned: string, ticked: string[] = []): string[] {
  const fromScan = scanned
    .split(/\r?\n/)
    .flatMap((line) => (imeiRuns(line).length ? [line.trim()] : line.split(/[\s,]+/)));
  const all = [...ticked, ...fromScan].map((s) => s.trim()).filter(Boolean);
  return [...new Set(all)];
}

/**
 * Finds the item a scanned code belongs to: the same id, or the same id in other letter case (SD cards and
 * rigs: unchanged). Only for MOBILES, a phone QR code also finds the phone by an IMEI in it (the same number,
 * or the same first 14 digits; the 15th is a check digit).
 */
export function matchScan(code: string, has: (id: string) => boolean, byUpper: Map<string, string>, phones: Map<string, string>) {
  if (has(code)) return code;
  const upper = byUpper.get(code.toUpperCase());
  if (upper !== undefined) return upper;
  for (const run of imeiRuns(code)) {
    const phone = phones.get(run.slice(0, 14));
    if (phone !== undefined) return phone;
  }
  return undefined;
}

/** Lookup tables for matchScan. `isPhone` says which ids are mobiles. */
export function scanIndex(ids: Iterable<string>, isPhone: (id: string) => boolean = () => false) {
  const byUpper = new Map<string, string>();
  const phones = new Map<string, string>(); // first 14 digits of a mobile's IMEI → its id
  for (const id of ids) {
    if (!byUpper.has(id.toUpperCase())) byUpper.set(id.toUpperCase(), id);
    if (isPhone(id) && /^\d{14,17}$/.test(id) && !phones.has(id.slice(0, 14))) phones.set(id.slice(0, 14), id);
  }
  return { byUpper, phones };
}

export type ScanState = "ok" | "unknown" | "wrong" | "duplicate";

export interface ScanRow {
  code: string; // exactly what the scanner typed
  id?: string; // the card's real serial, when the code matches one (letter case is ignored)
  state: ScanState;
  status?: string; // the card's current status, when it exists
}

/**
 * Explains each scanned line before anything is saved: ok, not a known card, a card in the wrong
 * state for this action, or a repeat. `allowed` is the set of statuses this action accepts.
 * Letter case is ignored, because a scanner with Caps Lock on types every capital as lowercase.
 */
export function classifyScans(
  text: string,
  statuses: Map<string, string>,
  allowed: ReadonlySet<string>,
  phones: ReadonlySet<string> = new Set(),
): ScanRow[] {
  const { byUpper, phones: byImei } = scanIndex(statuses.keys(), (id) => phones.has(id));

  const seen = new Set<string>();
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((code): ScanRow => {
      const id = matchScan(code, (x) => statuses.has(x), byUpper, byImei);
      const status = id === undefined ? undefined : statuses.get(id);
      const key = id ?? code;
      if (seen.has(key)) return { code, id, state: "duplicate", status };
      seen.add(key);
      if (id === undefined) return { code, state: "unknown" };
      return { code, id, state: allowed.has(status!) ? "ok" : "wrong", status };
    });
}
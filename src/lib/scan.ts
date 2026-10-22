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

/** Text compared without letter case or spaces, e.g. "Android Phone - 0221" = "android phone-0221". */
export const plainCode = (v: string) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");

/** A mobile's Asset Tag and Serial, from its saved details (JSON), to find it by either. */
export function mobileAliases(attributes: string): string[] {
  try {
    const a = JSON.parse(attributes || "{}") as Record<string, unknown>;
    return [a["Asset Tag"], a["Serial"]].map((v) => String(v ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Finds the item a scanned code belongs to: the same id, or the same id in other letter case (SD cards and
 * rigs: unchanged). Only for MOBILES, the phone is also found by an IMEI in the code (a QR code "IMEI1 - IMEI2";
 * same first 14 digits, the 15th is a check digit), or by its Asset Tag or Serial.
 */
export function matchScan(code: string, has: (id: string) => boolean, byUpper: Map<string, string>, phones: Map<string, string>) {
  if (has(code)) return code;
  const upper = byUpper.get(code.toUpperCase());
  if (upper !== undefined) return upper;
  for (const run of imeiRuns(code)) {
    const phone = phones.get(`imei:${run.slice(0, 14)}`);
    if (phone !== undefined) return phone;
  }
  return phones.get(`tag:${plainCode(code)}`);
}

/**
 * Lookup tables for matchScan. `phoneAliases` lists the mobiles: id → its Asset Tag and Serial.
 */
export function scanIndex(ids: Iterable<string>, phoneAliases: ReadonlyMap<string, string[]> = new Map()) {
  const byUpper = new Map<string, string>();
  const phones = new Map<string, string>(); // "imei:<first 14 digits>" or "tag:<asset tag / serial>" → mobile id
  for (const id of ids) {
    if (!byUpper.has(id.toUpperCase())) byUpper.set(id.toUpperCase(), id);
    const aliases = phoneAliases.get(id);
    if (!aliases) continue;
    if (/^\d{14,17}$/.test(id) && !phones.has(`imei:${id.slice(0, 14)}`)) phones.set(`imei:${id.slice(0, 14)}`, id);
    for (const a of aliases) if (plainCode(a) && !phones.has(`tag:${plainCode(a)}`)) phones.set(`tag:${plainCode(a)}`, id);
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
  phoneAliases: ReadonlyMap<string, string[]> = new Map(),
): ScanRow[] {
  const { byUpper, phones: byImei } = scanIndex(statuses.keys(), phoneAliases);

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
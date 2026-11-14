/**
 * HH:MM:SS duration helpers, for summing "SD Card Duration Hour" entries (lib/schema.ts's
 * sd_card_durations.duration, e.g. "603:16:28" — the hours part can go well past 24 once several
 * entries are added together, same as the Google Sheet this used to be tracked in by hand).
 */

/** "H:MM:SS" (or "HH:MM:SS", or just "MM:SS") → total seconds. Blank or unparseable → 0. */
export function parseHms(value: string | undefined): number {
  const parts = (value ?? "").trim().split(":").map((p) => Number(p));
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  if (parts.length === 1) return parts[0] * 3600; // a bare number is treated as hours
  return 0;
}

/** Total seconds → "H:MM:SS" (hours unpadded, can exceed 24; minutes/seconds always 2 digits). A
 *  negative total (e.g. "missing hours" going the other way) keeps a leading "-". */
export function formatHms(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  const abs = Math.round(Math.abs(totalSeconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${sign}${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Sum a list of "H:MM:SS" duration strings, in seconds. */
export function sumHms(values: (string | undefined)[]): number {
  return values.reduce((total, v) => total + parseHms(v), 0);
}
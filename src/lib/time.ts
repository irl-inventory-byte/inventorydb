// Every timestamp in the sheet is India Standard Time (UTC+05:30), written as
// 2026-09-25T19:14:54+05:30. The offset keeps it unambiguous, so Date.parse still gives the right instant.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The current time (or the given instant) as an IST timestamp. */
export function istTimestamp(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19) + "+05:30";
}

/** The IST calendar date, YYYY-MM-DD, of an instant. Used to group activity by day. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Rewrites an old UTC ("...Z") timestamp as IST. Anything else is returned unchanged. */
export function toIst(value: string): string {
  if (!value.endsWith("Z")) return value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : istTimestamp(new Date(t));
}

/** The IST hour of day (0–23) of an instant. Used to group activity by hour regardless of date. */
export function istHour(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** A stored timestamp as a readable IST date and time for the screen, whatever format it was saved in. */
export function formatIst(value: string): string {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value || "—";
  return new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}
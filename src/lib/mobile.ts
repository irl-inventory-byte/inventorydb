/**
 * Indian mobile numbers, stored as 10 digits (e.g. "9876543210").
 *
 * Accepts the usual ways people type them:
 *   9876543210, 98765 43210, 098765-43210, +91 98765 43210, 91-9876543210
 * Returns "" when the number is not a valid Indian mobile
 * (10 digits starting with 6, 7, 8 or 9).
 */
export function normalizeMobile(raw: string): string {
  let digits = String(raw ?? "").replace(/[^0-9]/g, "");

  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  return /^[6-9][0-9]{9}$/.test(digits) ? digits : "";
}

/** "9876543210" → "98765 43210" for display. */
export function formatMobile(mobile: string): string {
  const m = normalizeMobile(mobile);
  return m ? `${m.slice(0, 5)} ${m.slice(5)}` : mobile;
}
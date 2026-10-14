import type { Hub } from "@/lib/schema";

/** The person roles, in the order shown in dropdowns. */
export const PERSON_ROLES = [
  ["im", "IM"],
  ["ifo", "IFO"],
  ["fo", "FO"],
  ["rig", "Rig team"],
  ["hardware", "Hardware team"],
  ["qc", "QC team"],
  ["internal", "Internal"],
] as const;
export type PersonRole = (typeof PERSON_ROLES)[number][0];

const isRole = (v: string): v is PersonRole => PERSON_ROLES.some(([r]) => r === v);

/** How a city is compared: trimmed and lowercase, so "Kadapa " and "kadapa" are the same city. */
export const cityKey = (s: string) => s.trim().toLowerCase();

/** A hub's city as shown: its city, or its name when the city is blank. */
export const cityLabel = (h: Hub) => (h.city ?? "").trim() || h.name.trim();

/** The role and city filters from the address bar. An unknown role is ignored. */
export function readFilters(sp: Record<string, string | string[] | undefined>) {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const role = cityKey(first(sp.role));
  return { role: isRole(role) ? role : "", city: cityKey(first(sp.city)) };
}

/** The filters as a query string ("role=fo&city=kadapa"), or "" when none are set. */
export function filterQuery(f: { role?: string; city?: string }): string {
  const q = new URLSearchParams();
  if (f.role) q.set("role", f.role);
  if (f.city) q.set("city", f.city);
  return q.toString();
}

/** Back to the People page with the same filters, plus a result such as done=saved or error=invalid. */
export function peopleUrl(keep: string, result: Record<string, string>): string {
  const q = new URLSearchParams(keep);
  // Only the two filter values are carried over, whatever else the form sent.
  const safe = new URLSearchParams(filterQuery({ role: q.get("role") ?? "", city: q.get("city") ?? "" }));
  for (const [k, v] of Object.entries(result)) safe.set(k, v);
  return `/admin/people?${safe}`;
}
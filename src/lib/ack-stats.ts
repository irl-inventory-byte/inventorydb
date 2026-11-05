import type { Acknowledgment, Hub, Person } from "./schema";
import { istDate } from "./time";

export interface AckBucket {
  label: string;
  yes: number;
  no: number;
  pending: number; // not answered yet
  total: number;
}

function bucket(label: string): AckBucket {
  return { label, yes: 0, no: 0, pending: 0, total: 0 };
}

function add(b: AckBucket, a: Acknowledgment) {
  b.total++;
  if (a.answer === "yes") b.yes++;
  else if (a.answer === "no") b.no++;
  else b.pending++;
}

/**
 * Handover-receipt acknowledgments to an FO or IFO, grouped by the city they're in. Only FO/IFO
 * recipients are counted — acknowledgment emails go to them only (see lib/receipt-archive.ts).
 * `roleFilter` narrows to just FO or just IFO recipients; "" (default) keeps both.
 */
export function ackByCity(acks: Acknowledgment[], people: Person[], hubs: Hub[], roleFilter: "" | "fo" | "ifo" = ""): AckBucket[] {
  const roleOf = new Map(people.map((p) => [p.person_id, p.role]));
  const hubOf = new Map(people.map((p) => [p.person_id, p.hub]));
  const cityOf = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));
  const buckets = new Map<string, AckBucket>();
  for (const a of acks) {
    const role = roleOf.get(a.to_id);
    if (role !== "fo" && role !== "ifo") continue;
    if (roleFilter && role !== roleFilter) continue;
    const city = cityOf.get(hubOf.get(a.to_id) ?? "") || "Not set";
    if (!buckets.has(city)) buckets.set(city, bucket(city));
    add(buckets.get(city)!, a);
  }
  return [...buckets.values()].sort((x, y) => y.total - x.total);
}

/** Same acknowledgments, grouped by FO vs IFO instead of city. `roleFilter` narrows to just one. */
export function ackByRole(acks: Acknowledgment[], people: Person[], roleFilter: "" | "fo" | "ifo" = ""): AckBucket[] {
  const roleOf = new Map(people.map((p) => [p.person_id, p.role]));
  const fo = bucket("FO");
  const ifo = bucket("IFO");
  for (const a of acks) {
    const role = roleOf.get(a.to_id);
    if (roleFilter && role !== roleFilter) continue;
    if (role === "fo") add(fo, a);
    else if (role === "ifo") add(ifo, a);
  }
  return [fo, ifo].filter((b) => b.total > 0);
}

/**
 * Same acknowledgments, grouped by the calendar day they were sent (IST), oldest first — a daily trend
 * instead of a breakdown. Only FO/IFO recipients are counted, same as ackByCity. `roleFilter` narrows to
 * just FO or just IFO; "" (default) keeps both. An undated row (created_at missing or unparseable) is
 * grouped under "Unknown date" at the end, rather than silently dropped.
 */
export function ackByDay(acks: Acknowledgment[], people: Person[], roleFilter: "" | "fo" | "ifo" = ""): AckBucket[] {
  const roleOf = new Map(people.map((p) => [p.person_id, p.role]));
  const buckets = new Map<string, AckBucket>();
  const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
  for (const a of acks) {
    const role = roleOf.get(a.to_id);
    if (role !== "fo" && role !== "ifo") continue;
    if (roleFilter && role !== roleFilter) continue;
    const t = Date.parse(a.created_at || "");
    const key = Number.isNaN(t) ? "unknown" : istDate(new Date(t));
    const label = key === "unknown" ? "Unknown date" : dayLabel(key);
    if (!buckets.has(key)) buckets.set(key, bucket(label));
    add(buckets.get(key)!, a);
  }
  const known = [...buckets.entries()].filter(([k]) => k !== "unknown").sort(([a], [b]) => a.localeCompare(b));
  const unknown = buckets.has("unknown") ? [["unknown", buckets.get("unknown")!] as const] : [];
  return [...known, ...unknown].map(([, b]) => b);
}
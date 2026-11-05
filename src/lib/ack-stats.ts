import type { Acknowledgment, Hub, Person } from "./schema";
import { istDate, istHour } from "./time";

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

/**
 * Same acknowledgments, grouped by the hour of day (IST) they were sent, 12 AM through 11 PM, regardless
 * of which date — a "what time of day do these tend to go out" view, not a trend over time like
 * ackByDay. Only FO/IFO recipients are counted, same as ackByCity. An undated row (created_at missing or
 * unparseable) is grouped under "Unknown time" at the end.
 */
export function ackByHour(acks: Acknowledgment[], people: Person[], roleFilter: "" | "fo" | "ifo" = ""): AckBucket[] {
  const roleOf = new Map(people.map((p) => [p.person_id, p.role]));
  const hourLabel = (h: number) => (h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`);
  const buckets = Array.from({ length: 24 }, (_, h) => bucket(hourLabel(h)));
  const unknown = bucket("Unknown time");
  for (const a of acks) {
    const role = roleOf.get(a.to_id);
    if (role !== "fo" && role !== "ifo") continue;
    if (roleFilter && role !== roleFilter) continue;
    const t = Date.parse(a.created_at || "");
    if (Number.isNaN(t)) add(unknown, a);
    else add(buckets[istHour(new Date(t))], a);
  }
  return unknown.total > 0 ? [...buckets, unknown] : buckets;
}

/**
 * Average time (in minutes) between an acknowledgment being sent (created_at) and it being answered
 * (answered_at), over answered acks only (yes or no — a pending one has no answered_at yet). Only
 * FO/IFO recipients are counted, same as ackByCity. Returns null when nothing answered has a usable
 * pair of timestamps (e.g. no acks answered yet in the filtered range).
 */
export function ackAvgResponseMinutes(acks: Acknowledgment[], people: Person[], roleFilter: "" | "fo" | "ifo" = ""): number | null {
  const roleOf = new Map(people.map((p) => [p.person_id, p.role]));
  let totalMs = 0;
  let count = 0;
  for (const a of acks) {
    const role = roleOf.get(a.to_id);
    if (role !== "fo" && role !== "ifo") continue;
    if (roleFilter && role !== roleFilter) continue;
    if (a.answer !== "yes" && a.answer !== "no") continue;
    const sent = Date.parse(a.created_at || "");
    const answered = Date.parse(a.answered_at || "");
    if (Number.isNaN(sent) || Number.isNaN(answered) || answered < sent) continue;
    totalMs += answered - sent;
    count++;
  }
  return count > 0 ? totalMs / count / 60000 : null;
}

/** "2h 15m", "48m" or "3d 4h" — a response-time average formatted for the screen. */
export function formatResponseMinutes(minutes: number): string {
  const mins = Math.round(minutes);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}
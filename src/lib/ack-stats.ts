import type { Acknowledgment, Hub, Person } from "./schema";

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
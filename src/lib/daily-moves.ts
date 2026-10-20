import type { Hub, ItemEvent, Person } from "./schema";
import { istDate } from "./time";

const DAY = 86_400_000;

export interface MoveDay {
  date: string; // YYYY-MM-DD, India day
  sent: number; // check-outs
  received: number; // check-ins
  corrected: number; // corrections (shown in the tooltip and table only)
}

export interface MoveFilter {
  person?: string; // person_id: only handovers this person sent or received
  city?: string; // only handovers to or from a hub in this city
  role?: string; // only handovers sent or received by someone with this role (fo, ifo, im, …)
}

/** City of a hub: its City column, or its name when City is blank. */
export const hubCityMap = (hubs: Hub[]) => new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));

/** Does this handover match the person / city / role filter? `roleOf` gives a person's role. */
export function matchesMove(e: ItemEvent, f: MoveFilter, city: Map<string, string>, roleOf: Map<string, string> = new Map()): boolean {
  if (f.person && e.from_id !== f.person && e.to_id !== f.person) return false;
  if (f.role && roleOf.get(e.from_id) !== f.role && roleOf.get(e.to_id) !== f.role) return false;
  if (f.city) {
    const here = city.get(e.hub) ?? e.hub;
    const from = city.get(e.from_hub) ?? e.from_hub;
    if (here !== f.city && from !== f.city) return false;
  }
  return true;
}

/**
 * Items sent and received per India day for the last `days` days (oldest first, quiet days as zeros),
 * after the person / city filter. `events` should already be the chosen item type (SD cards or rigs).
 */
export function dailyMoves(
  events: ItemEvent[],
  hubs: Hub[],
  now: Date,
  days = 14,
  f: MoveFilter = {},
  people: Person[] = [],
): MoveDay[] {
  const city = hubCityMap(hubs);
  const roleOf = new Map(people.map((p) => [p.person_id, p.role as string]));
  const out: MoveDay[] = [];
  const index = new Map<string, MoveDay>();
  for (let n = days - 1; n >= 0; n--) {
    const day = { date: istDate(new Date(now.getTime() - n * DAY)), sent: 0, received: 0, corrected: 0 };
    out.push(day);
    index.set(day.date, day);
  }
  for (const e of events) {
    const at = Date.parse(e.occurred_at);
    const day = Number.isNaN(at) ? undefined : index.get(istDate(new Date(at)));
    if (!day || !matchesMove(e, f, city, roleOf)) continue;
    if (e.action === "check_out") day.sent++;
    else if (e.action === "receive") day.received++;
    else if (e.action === "correct" || e.action === "reassign_home_hub") day.corrected++;
  }
  return out;
}

/**
 * Choices for the filters: every person, city and role that appears in the handovers of the last `days`
 * days, so the lists only offer choices that can show something. Sorted A–Z.
 */
export function moveFilterOptions(events: ItemEvent[], hubs: Hub[], people: Person[], now: Date, days = 14) {
  const city = hubCityMap(hubs);
  const from = now.getTime() - days * DAY;
  const name = new Map(people.map((p) => [p.person_id, p.name]));
  const roleOf = new Map(people.map((p) => [p.person_id, p.role as string]));
  const roles = new Set<string>();
  const personIds = new Map<string, string>();
  const cities = new Set<string>();
  for (const e of events) {
    const at = Date.parse(e.occurred_at);
    if (Number.isNaN(at) || at < from) continue;
    if (e.action !== "check_out" && e.action !== "receive") continue;
    for (const [id, label] of [
      [e.from_id, e.from_person],
      [e.to_id, e.to_person],
    ]) {
      if (id && !personIds.has(id)) personIds.set(id, name.get(id) || label || id);
      const role = id ? roleOf.get(id) : undefined;
      if (role) roles.add(role);
    }
    for (const h of [e.hub, e.from_hub]) if (h) cities.add(city.get(h) ?? h);
  }
  return {
    people: [...personIds.entries()]
      .map(([id, label]) => ({ id, label, role: roleOf.get(id) ?? "" }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    roles: [...roles].sort((a, b) => a.localeCompare(b)),
    cities: [...cities].filter(Boolean).sort((a, b) => a.localeCompare(b)),
  };
}

/** Short number for a bar label: 950, 1.2k, 12k. */
export const compact = (v: number) => (v < 1000 ? String(v) : v < 10000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(v / 1000)}k`);
import type { Hub, ItemEvent, Person } from "./schema";
import { istDate } from "./time";

const DAY = 86_400_000;

export interface MoveDay {
  date: string; // YYYY-MM-DD, India day
  sent: number; // check-outs
  received: number; // check-ins
  corrected: number; // corrections (shown in the tooltip and table only)
}

/** A date range in India days, both ends included: "2026-10-07" … "2026-10-20". */
export interface DayRange {
  from: string;
  to: string;
}

export const MAX_RANGE_DAYS = 92; // about 3 months; longer ranges are cut to the last 92 days

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(dayMs(v));
const addDays = (iso: string, n: number) => new Date(dayMs(iso) + n * DAY).toISOString().slice(0, 10);

/**
 * The range to show from the ?mfrom= / ?mto= values. Missing or invalid → the last `defaultDays` days up to
 * today (India). From after To → swapped. Longer than MAX_RANGE_DAYS → cut to the last MAX_RANGE_DAYS days.
 */
export function pickRange(
  fromRaw: string,
  toRaw: string,
  now: Date,
  defaultDays = 14,
  maxDays = MAX_RANGE_DAYS,
): DayRange & { days: number; cut: boolean } {
  const today = istDate(now);
  let to = isDay(toRaw) ? toRaw : today;
  let from = isDay(fromRaw) ? fromRaw : addDays(to, -(defaultDays - 1));
  if (from > to) [from, to] = [to, from];
  let cut = false;
  if ((dayMs(to) - dayMs(from)) / DAY + 1 > maxDays) {
    from = addDays(to, -(maxDays - 1));
    cut = true;
  }
  return { from, to, days: Math.round((dayMs(to) - dayMs(from)) / DAY) + 1, cut };
}

/** One value or several (a multi-select); empty = no filter. */
export type Many = string | readonly string[] | undefined;

export interface MoveFilter {
  person?: Many; // person_id(s): only handovers one of these people sent or received
  city?: Many; // only handovers to or from a hub in one of these cities
  role?: Many; // only handovers sent or received by someone with one of these roles (fo, ifo, im, …)
}

/** The chosen values as a list, from one value, several, or "a,b" text. */
export function manyValues(v: Many): string[] {
  const list = typeof v === "string" ? [v] : v ? [...v] : [];
  return [...new Set(list.flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean))];
}

/** City of a hub: its City column, or its name when City is blank. */
export const hubCityMap = (hubs: Hub[]) => new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));

/** A test for the person / city / role filter (each may hold several values). `roleOf` gives a person's role. */
export function moveMatcher(f: MoveFilter, city: Map<string, string>, roleOf: Map<string, string> = new Map()) {
  const persons = new Set(manyValues(f.person));
  const roles = new Set(manyValues(f.role));
  const cities = new Set(manyValues(f.city));
  return (e: ItemEvent): boolean => {
    if (persons.size && !persons.has(e.from_id) && !persons.has(e.to_id)) return false;
    if (roles.size && !roles.has(roleOf.get(e.from_id) ?? "") && !roles.has(roleOf.get(e.to_id) ?? "")) return false;
    if (cities.size) {
      const here = city.get(e.hub) ?? e.hub;
      const from = city.get(e.from_hub) ?? e.from_hub;
      if (!cities.has(here) && !cities.has(from)) return false;
    }
    return true;
  };
}

/** Does this handover match the person / city / role filter? `roleOf` gives a person's role. */
export function matchesMove(e: ItemEvent, f: MoveFilter, city: Map<string, string>, roleOf: Map<string, string> = new Map()): boolean {
  return moveMatcher(f, city, roleOf)(e);
}

/**
 * Items sent and received per India day from range.from to range.to (oldest first, quiet days as zeros),
 * after the person / city / role filter. `events` should already be the chosen item type (SD cards or rigs).
 */
export function dailyMoves(
  events: ItemEvent[],
  hubs: Hub[],
  range: DayRange,
  f: MoveFilter = {},
  people: Person[] = [],
): MoveDay[] {
  const city = hubCityMap(hubs);
  const roleOf = new Map(people.map((p) => [p.person_id, p.role as string]));
  const match = moveMatcher(f, city, roleOf);
  const out: MoveDay[] = [];
  const index = new Map<string, MoveDay>();
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const day = { date: d, sent: 0, received: 0, corrected: 0 };
    out.push(day);
    index.set(day.date, day);
  }
  for (const e of events) {
    const at = Date.parse(e.occurred_at);
    const day = Number.isNaN(at) ? undefined : index.get(istDate(new Date(at)));
    if (!day || !match(e)) continue;
    if (e.action === "check_out") day.sent++;
    else if (e.action === "receive") day.received++;
    else if (e.action === "correct" || e.action === "reassign_home_hub") day.corrected++;
  }
  return out;
}

/**
 * Choices for the filters: every person, city and role that appears in the handovers of the chosen
 * date range, so the lists only offer choices that can show something. Sorted A–Z.
 */
export function moveFilterOptions(events: ItemEvent[], hubs: Hub[], people: Person[], range: DayRange) {
  const city = hubCityMap(hubs);
  const name = new Map(people.map((p) => [p.person_id, p.name]));
  const roleOf = new Map(people.map((p) => [p.person_id, p.role as string]));
  const roles = new Set<string>();
  const personIds = new Map<string, string>();
  const cities = new Set<string>();
  for (const e of events) {
    const at = Date.parse(e.occurred_at);
    if (Number.isNaN(at)) continue;
    const day = istDate(new Date(at));
    if (day < range.from || day > range.to) continue;
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
export interface MoveHour {
  hour: number; // 0–23, India time
  sent: number; // check-outs
  received: number; // check-ins
}

/**
 * Items sent and received per hour of the day (India time, 00:00–23:59), added up over every day from
 * range.from to range.to, after the same person / city / role filter as the day chart. Shows the busy hours.
 */
export function hourlyMoves(
  events: ItemEvent[],
  hubs: Hub[],
  range: DayRange,
  f: MoveFilter = {},
  people: Person[] = [],
): MoveHour[] {
  const city = hubCityMap(hubs);
  const roleOf = new Map(people.map((p) => [p.person_id, p.role as string]));
  const match = moveMatcher(f, city, roleOf);
  const out: MoveHour[] = Array.from({ length: 24 }, (_, hour) => ({ hour, sent: 0, received: 0 }));
  for (const e of events) {
    if (e.action !== "check_out" && e.action !== "receive") continue;
    const at = Date.parse(e.occurred_at);
    if (Number.isNaN(at)) continue;
    const ist = new Date(at + 5.5 * 3_600_000);
    const day = ist.toISOString().slice(0, 10);
    if (day < range.from || day > range.to || !match(e)) continue;
    const slot = out[ist.getUTCHours()];
    if (e.action === "check_out") slot.sent++;
    else slot.received++;
  }
  return out;
}

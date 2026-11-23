import { LATE_AFTER_HOURS, computeDashboard } from "./dashboard";
import { ROLE_LABELS, STATUS_LABELS } from "./labels";
import type { Hub, Item, ItemEvent, Person, Status } from "./schema";
import { formatIst } from "./time";

/**
 * Shared "Need attention" row builder for the standalone /attention page and its PDF download
 * (src/app/attention/page.tsx, src/app/api/attention/pdf/route.ts). Deliberately a separate module
 * from src/app/dashboard/page.tsx's own "Needs attention" block, which it mirrors on purpose rather
 * than sharing code with — the dashboard page's version stays untouched, and this one is scoped to
 * ALL item types at once (Rigs, SD cards, Mobiles, Power banks), not just whichever type tab is
 * selected there. See dashboard/page.tsx for the original this was adapted from.
 */

export const TYPE_NAME: Record<string, string> = { sd_card: "SD card", rig: "Rig", mobile: "Mobile", power_bank: "Power bank" };

/** A time as an IST date, e.g. "8 Oct 2026". */
const istDay = (t: number) => new Date(t).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

const inventory = (params: Record<string, string>) => `/inventory?${new URLSearchParams(params)}`;

export interface AttentionItem {
  key: string;
  person: string;
  role: string;
  city: string;
  sentBy: string;
  items: number;
  hours: number | null;
  outFor: string;
  issue: string;
  href: string;
}

export interface DelayedRow {
  id: string;
  type: string;
  person: string;
  role: string;
  city: string;
  sentBy: string;
  sentOn: string;
  sentAt: string;
  status: string;
  hours: number;
  issue: string;
  href: string;
  count: number;
  key: string;
}

export interface AttentionReport {
  attention: AttentionItem[];
  delayed: Omit<DelayedRow, "count" | "key">[];
  shownDelayed: DelayedRow[];
  byType: Map<string, number>;
}

export function howLong(hours: number): string {
  return hours < 48 ? `${Math.floor(hours)} hours` : `${Math.floor(hours / 24)} days`;
}

export interface AttentionFilters {
  minDays?: number; // out for more than this many days; 0/undefined = no cutoff beyond LATE_AFTER_HOURS
  type?: string; // r.type, e.g. "SD card" — blank = all
  role?: string; // r.role, e.g. "FO", "IFO", "Hub" — blank = all
  city?: string; // r.city — blank = all
}

/** Narrows an already-built shownDelayed/delayed list down to one page's (or the PDF's) filters. */
export function filterDelayed<T extends { hours: number; type: string; role: string; city: string }>(
  rows: T[],
  f: AttentionFilters,
): T[] {
  return rows.filter(
    (r) =>
      (!f.minDays || r.hours > f.minDays * 24) &&
      (!f.type || r.type === f.type) &&
      (!f.role || r.role === f.role) &&
      (!f.city || r.city === f.city),
  );
}

/** Distinct Type / Role / City values across a shownDelayed list, for building filter dropdowns. */
export function filterOptions<T extends { type: string; role: string; city: string }>(rows: T[]) {
  const uniq = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
  return {
    types: uniq(rows.map((r) => r.type)),
    roles: uniq(rows.map((r) => r.role)),
    cities: uniq(rows.map((r) => r.city)),
  };
}

/** Everything needing attention right now, across every item type passed in. Pure, like computeDashboard. */
export function buildAttentionReport(items: Item[], events: ItemEvent[], people: Person[], hubs: Hub[], now: Date): AttentionReport {
  const d = computeDashboard(items, events, people, hubs, { hub: "", days: 14, now });

  const attention: AttentionItem[] = [];
  const attentionLate = new Map<string, Item[]>();
  const seen = new Set<string>();

  const hubCity = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));
  const holderCities = new Map<string, Set<string>>();
  for (const i of items) {
    if (!i.current_holder || i.status === "in_stock") continue;
    const set = holderCities.get(i.current_holder) ?? new Set<string>();
    set.add(hubCity.get(i.current_hub) ?? i.current_hub);
    holderCities.set(i.current_holder, set);
  }
  const personHub = new Map(people.map((p) => [p.person_id, p.hub]));

  const eventById = new Map(events.map((e) => [e.event_id, e]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));
  const senders = (list: Item[]) => {
    const count = new Map<string, number>();
    for (const i of list) {
      const e = eventById.get(i.last_event_id);
      const who = (e?.from_person || personName.get(e?.from_id ?? "") || e?.from_id || "").trim();
      if (who) count.set(who, (count.get(who) ?? 0) + 1);
    }
    const sorted = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (sorted.length === 0) return "—";
    if (sorted.length === 1) return sorted[0][0];
    const shown = sorted.slice(0, 3).map(([who, c]) => `${who} (${c})`).join(", ");
    return sorted.length > 3 ? `${shown} +${sorted.length - 3} more` : shown;
  };
  const lastMove = new Map<string, number>();
  for (const e of events) {
    const t = Date.parse(e.occurred_at);
    if (!Number.isNaN(t) && t > (lastMove.get(e.item_id) ?? -Infinity)) lastMove.set(e.item_id, t);
  }
  const hoursOut = (i: Item) => {
    const t = lastMove.get(i.item_id) ?? Date.parse(i.updated_at);
    return Number.isNaN(t) ? 0 : Math.max(0, (now.getTime() - t) / 3_600_000);
  };
  const isLate = (i: Item) => hoursOut(i) > LATE_AFTER_HOURS;
  const lateWith = (id: string, status: Status) => items.filter((i) => i.current_holder === id && i.status === status && isLate(i));
  const sentToPerson = (id: string, status: Status) => senders(lateWith(id, status));
  const sentToHub = (hubId: string) => senders(items.filter((i) => i.status === "pending" && i.current_hub === hubId && isLate(i)));
  const cityOfPerson = (id: string, status: Status) => {
    const late = [...new Set(lateWith(id, status).map((i) => hubCity.get(i.current_hub) ?? i.current_hub))].filter(Boolean);
    if (late.length) return late.sort().join(", ");
    const set = holderCities.get(id);
    if (set && set.size) return [...set].filter(Boolean).sort().join(", ");
    const hub = personHub.get(id);
    return hub ? (hubCity.get(hub) ?? hub) : "—";
  };

  const push = (row: AttentionItem, late: Item[]) => {
    attention.push(row);
    attentionLate.set(row.key, late);
  };

  for (const g of d.late) {
    seen.add(g.key);
    if (g.kind === "pending") {
      push(
        {
          key: `late-pending-${g.key}`,
          person: g.label,
          role: "Hub",
          city: hubCity.get(g.key) ?? g.key,
          sentBy: sentToHub(g.key),
          items: g.count,
          hours: g.oldestHours,
          outFor: howLong(g.oldestHours),
          issue: "Sent, not received",
          href: `/handover/receive?${new URLSearchParams({ hub: g.key })}`,
        },
        items.filter((i) => i.status === "pending" && i.current_hub === g.key && isLate(i)),
      );
    } else {
      const status: Status = g.kind === "fo" ? "with_fo" : "traveling";
      push(
        {
          key: `late-${g.kind}-${g.key}`,
          person: g.label,
          role: g.kind === "fo" ? "FO" : "IFO",
          city: cityOfPerson(g.key, status),
          sentBy: sentToPerson(g.key, status),
          items: g.count,
          hours: g.oldestHours,
          outFor: howLong(g.oldestHours),
          issue: g.kind === "fo" ? "Not returned" : "Not arrived",
          href: inventory({ holder: g.key, status }),
        },
        lateWith(g.key, status),
      );
    }
  }

  const heldBy = new Map<string, { status: Status; count: number; hours: number }>();
  for (const i of items) {
    if (i.status !== "with_rig" && i.status !== "with_internal") continue;
    if (!i.current_holder || seen.has(i.current_holder)) continue;
    const hours = hoursOut(i);
    if (hours <= LATE_AFTER_HOURS) continue;
    const g = heldBy.get(i.current_holder) ?? { status: i.status, count: 0, hours: 0 };
    g.count++;
    g.hours = Math.max(g.hours, hours);
    heldBy.set(i.current_holder, g);
  }
  for (const [personId, g] of heldBy) {
    const person = people.find((p) => p.person_id === personId);
    push(
      {
        key: `late-held-${personId}`,
        person: person?.name ?? personId,
        role: person ? ROLE_LABELS[person.role] : g.status === "with_rig" ? "Rig team" : "Internal",
        city: cityOfPerson(personId, g.status),
        sentBy: sentToPerson(personId, g.status),
        items: g.count,
        hours: g.hours,
        outFor: howLong(g.hours),
        issue: "Not returned",
        href: inventory({ holder: personId, status: g.status }),
      },
      lateWith(personId, g.status),
    );
  }

  const heldByHardware = new Map<string, { count: number; hours: number }>();
  for (const i of items) {
    if (i.status !== "with_hardware") continue;
    if (!i.current_holder || seen.has(i.current_holder)) continue;
    const hours = hoursOut(i);
    if (hours <= LATE_AFTER_HOURS) continue;
    const g = heldByHardware.get(i.current_holder) ?? { count: 0, hours: 0 };
    g.count++;
    g.hours = Math.max(g.hours, hours);
    heldByHardware.set(i.current_holder, g);
  }
  for (const [personId, g] of heldByHardware) {
    const person = people.find((p) => p.person_id === personId);
    push(
      {
        key: `late-hardware-${personId}`,
        person: person?.name ?? personId,
        role: person ? ROLE_LABELS[person.role] : "Hardware",
        city: cityOfPerson(personId, "with_hardware"),
        sentBy: sentToPerson(personId, "with_hardware"),
        items: g.count,
        hours: g.hours,
        outFor: howLong(g.hours),
        issue: "Not sent to IM",
        href: inventory({ holder: personId, status: "with_hardware" }),
      },
      lateWith(personId, "with_hardware"),
    );
  }

  attention.sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1) || b.items - a.items);

  const delayed = attention
    .flatMap((a) =>
      (attentionLate.get(a.key) ?? []).map((i) => {
        const e = eventById.get(i.last_event_id);
        const sentAt = lastMove.get(i.item_id) ?? Date.parse(i.updated_at);
        return {
          id: i.item_id,
          type: TYPE_NAME[i.item_type] ?? i.item_type,
          person: a.person,
          role: a.role,
          city: hubCity.get(i.current_hub) ?? i.current_hub,
          sentBy: (e?.from_person || personName.get(e?.from_id ?? "") || e?.from_id || "—").trim() || "—",
          sentOn: Number.isNaN(sentAt) ? "—" : istDay(sentAt),
          sentAt: Number.isNaN(sentAt) ? "—" : formatIst(new Date(sentAt).toISOString()),
          status: STATUS_LABELS[i.status] ?? i.status,
          hours: hoursOut(i),
          issue: a.issue,
          href: a.href,
        };
      }),
    )
    .sort((x, y) => y.hours - x.hours || x.id.localeCompare(y.id));

  const groups = new Map<string, DelayedRow>();
  for (const r of delayed) {
    const k = [r.type, r.person, r.role, r.city, r.sentBy, r.sentOn, r.issue].join("|");
    const g = groups.get(k);
    if (g) {
      g.count++;
      g.hours = Math.max(g.hours, r.hours);
    } else groups.set(k, { ...r, count: 1, key: k });
  }
  const shownDelayed = [...groups.values()].sort((x, y) => y.hours - x.hours || y.count - x.count);

  const byType = new Map<string, number>();
  for (const r of delayed) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);

  return { attention, delayed, shownDelayed, byType };
}
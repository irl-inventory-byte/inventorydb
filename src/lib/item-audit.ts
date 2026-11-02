import type { Audit, Hub, Item, ItemEvent, Status } from "./schema";

/**
 * CITY / HUB AUDIT: every IN-STOCK item (SD card, rig or mobile) that hasn't had a status change
 * (handover) for `minDays` days or more. Only "in_stock" items are listed — this page is for
 * physically checking stock sitting at a hub, so an item that's out with someone (traveling, with an
 * FO, with the rig team, etc.) isn't something you can walk up to and audit. "Activity" here means
 * the item's last handover event; if it has never had one, its `updated_at` is used instead (e.g. a
 * freshly added item that has sat untouched since).
 */
export interface UnusedItem {
  item_id: string;
  item_type: string;
  status: Status;
  hub: string;
  city: string;
  lastActivity: string; // ISO timestamp, "" if unknown
  days: number; // whole days since lastActivity
}

export function unusedItems(items: Item[], events: ItemEvent[], hubs: Hub[], now: Date, minDays = 1): UnusedItem[] {
  const hubCity = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));

  // Latest event per item (events are usually oldest-first, but this doesn't assume that).
  const lastEventAt = new Map<string, string>();
  for (const e of events) {
    const prev = lastEventAt.get(e.item_id);
    if (!prev || Date.parse(e.occurred_at) > Date.parse(prev)) lastEventAt.set(e.item_id, e.occurred_at);
  }

  const out: UnusedItem[] = [];
  for (const i of items) {
    if (i.status !== "in_stock") continue;
    const last = lastEventAt.get(i.item_id) || i.updated_at || "";
    const t = Date.parse(last);
    if (!Number.isFinite(t)) continue;
    const days = Math.floor((now.getTime() - t) / 86_400_000);
    if (days < minDays) continue;
    out.push({
      item_id: i.item_id,
      item_type: i.item_type,
      status: i.status,
      hub: i.current_hub,
      city: hubCity.get(i.current_hub) || i.current_hub || "Not set",
      lastActivity: last,
      days,
    });
  }
  return out.sort((a, b) => b.days - a.days || a.city.localeCompare(b.city) || a.item_id.localeCompare(b.item_id));
}

/** The most recent audit date per item, "" if never audited. */
export function lastAuditedAt(audits: Audit[]): Map<string, string> {
  const last = new Map<string, string>();
  for (const a of audits) {
    const prev = last.get(a.item_id);
    if (!prev || Date.parse(a.audited_at) > Date.parse(prev)) last.set(a.item_id, a.audited_at);
  }
  return last;
}

/** City-wise counts, biggest first. */
export function unusedByCity(rows: UnusedItem[]): { city: string; count: number }[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.city, (count.get(r.city) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([city, c]) => ({ city, count: c }));
}

/** Hub-wise counts within one city (or all hubs when city is ""), biggest first. */
export function unusedByHub(rows: UnusedItem[], hubs: Hub[], city = ""): { hub: string; hubName: string; count: number }[] {
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const count = new Map<string, number>();
  for (const r of rows) {
    if (city && r.city !== city) continue;
    count.set(r.hub, (count.get(r.hub) ?? 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([hub, c]) => ({ hub, hubName: hubName.get(hub) || hub || "Not set", count: c }));
}
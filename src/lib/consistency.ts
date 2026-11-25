import type { Item, ItemEvent } from "./schema";

export interface Inconsistency {
  item_id: string;
  item_type: string;
  reason: string;
}

/** Flags items whose stored status / last event differs from their latest event (events are in append order). */
export function findInconsistencies(items: Item[], events: ItemEvent[]): Inconsistency[] {
  const latest = new Map<string, ItemEvent>();
  for (const e of events) latest.set(e.item_id, e);
  const problems: Inconsistency[] = [];
  for (const item of items) {
    const last = latest.get(item.item_id);
    if (!last) continue; // no events yet, e.g. loaded straight into the sheet
    if (item.last_event_id !== last.event_id) {
      problems.push({ item_id: item.item_id, item_type: item.item_type, reason: "items row is behind the latest event" });
    } else if (item.status !== last.status_after) {
      problems.push({ item_id: item.item_id, item_type: item.item_type, reason: "status differs from latest event" });
    }
  }
  return problems;
}
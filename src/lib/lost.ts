import type { Hub, Item, ItemEvent, LostNote, Status } from "./schema";

/**
 * LOST ITEMS: detail rows for the "Lost" (or "Broken") dashboard tile. There is no dedicated
 * "report lost" action in this app — an item becomes lost/damaged through the Correction form,
 * which creates a "correct" event with a required note. That event is treated as the report: its
 * date, who last held the item, and who recorded it. Further investigation notes are added
 * separately (see lost_notes tab) and shown oldest-first alongside that original note.
 */
export interface LostRow {
  item_id: string;
  item_type: string;
  status: Status;
  hub: string;
  city: string;
  amount: string; // item.price, "" if not set
  date: string; // ISO timestamp the item was marked lost/damaged, "" if unknown
  lastHeldBy: string; // who had the item just before it was marked lost/damaged ("" if nobody / unknown)
  recordedBy: string; // login email that recorded the correction
  recordedByName: string;
  initialNote: string; // the correction note written at the time
}

export function lostList(items: Item[], events: ItemEvent[], hubs: Hub[], status: Status = "lost"): LostRow[] {
  const hubCity = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));

  // The most recent event that set this status, per item (there can be several over an item's life
  // if it was marked lost, found, then lost again).
  const latest = new Map<string, ItemEvent>();
  for (const e of events) {
    if (e.status_after !== status) continue;
    const prev = latest.get(e.item_id);
    if (!prev || Date.parse(e.occurred_at || "") > Date.parse(prev.occurred_at || "")) latest.set(e.item_id, e);
  }

  const out: LostRow[] = [];
  for (const i of items) {
    if (i.status !== status) continue;
    const e = latest.get(i.item_id);
    out.push({
      item_id: i.item_id,
      item_type: i.item_type,
      status,
      hub: i.current_hub,
      city: hubCity.get(i.current_hub) || i.current_hub || "Not set",
      amount: i.price || "",
      date: e?.occurred_at || i.updated_at || "",
      lastHeldBy: e?.from_person || "",
      recordedBy: e?.recorded_by || "",
      recordedByName: "", // filled in by the caller (page.tsx), which has the people list for display names
      initialNote: e?.note || "",
    });
  }
  return out.sort((a, b) => Date.parse(b.date || "0") - Date.parse(a.date || "0") || a.item_id.localeCompare(b.item_id));
}

/** All investigation notes for one item, oldest first. */
export function notesFor(notes: LostNote[], itemId: string): LostNote[] {
  return notes
    .filter((n) => n.item_id === itemId)
    .sort((a, b) => Date.parse(a.recorded_at || "0") - Date.parse(b.recorded_at || "0"));
}
import type { Item } from "./schema";

/**
 * A card as it was before any activity: in stock at its home hub, held by nobody, with no history. Only
 * where the card IS changes. Its identity and details (serial, type, home hub, prism no., brand, model,
 * attributes) are left exactly as they are.
 */
export function activityBaseline(item: Item): Item {
  return {
    ...item,
    status: "in_stock",
    current_hub: item.home_hub || item.current_hub, // a card with no home hub stays where it is
    current_holder: "",
    last_event_id: "",
    updated_at: "",
  };
}

/** True if the card is anywhere other than its starting position, so a reset would change it. */
export function differsFromBaseline(item: Item): boolean {
  const b = activityBaseline(item);
  return (
    item.status !== b.status ||
    item.current_hub !== b.current_hub ||
    item.current_holder !== b.current_holder ||
    item.last_event_id !== b.last_event_id
  );
}
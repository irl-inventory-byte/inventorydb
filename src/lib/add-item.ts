import type { Hub, Item, ItemEvent } from "./schema";

export interface AddItemInput {
  itemId: string; // the serial, typically scanned
  homeHub: string; // hub_id; the card starts in stock here
  prismNo: string;
  brand: string;
  model: string;
  price: string;
  itemType?: string; // "sd_card" (default) or "rig"
  attributes?: string; // JSON of extra details
}

export interface AddItemContext {
  hubs: Hub[];
  by: string; // signed-in email, recorded_by
  now: string; // IST timestamp
  newId: (prefix: string) => string;
}

export interface AddItemPlan {
  event?: ItemEvent;
  item?: Item;
  errors: string[];
}

/**
 * Adds a brand new card: in stock at its home hub, with an "import" event so it has real history from
 * the start, same as any other movement. Matching against existing serials ignores letter case, same as
 * scanning elsewhere in the app.
 */
export function planAddItem(input: AddItemInput, existing: Item[], ctx: AddItemContext): AddItemPlan {
  const errors: string[] = [];
  const itemId = input.itemId.trim();
  if (!itemId) errors.push("Scan or type the item's serial.");
  else if (existing.some((i) => i.item_id.toUpperCase() === itemId.toUpperCase())) {
    errors.push(`${itemId} is already in the inventory.`);
  }

  const hub = ctx.hubs.find((h) => h.hub_id === input.homeHub && h.active !== "false");
  if (!hub) errors.push("Choose the home hub.");
  if (errors.length) return { errors };

  const event: ItemEvent = {
    event_id: ctx.newId("e"),
    batch_id: ctx.newId("b"),
    item_id: itemId,
    action: "import",
    from_person: "",
    to_person: "",
    from_id: "",
    to_id: "",
    from_hub: "",
    hub: input.homeHub,
    status_after: "in_stock",
    occurred_at: ctx.now,
    recorded_at: ctx.now,
    recorded_by: ctx.by,
    note: "Added to inventory",
  };
  const item: Item = {
    item_id: itemId,
    item_type: input.itemType || "sd_card",
    home_hub: input.homeHub,
    current_hub: input.homeHub,
    status: "in_stock",
    current_holder: "",
    last_event_id: event.event_id,
    updated_at: ctx.now,
    attributes: input.attributes ?? "",
    prism_no: input.prismNo.trim(),
    brand: input.brand.trim(),
    model: input.model.trim(),
    price: input.price.trim(),
  };
  return { event, item, errors: [] };
}
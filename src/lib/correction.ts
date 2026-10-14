import { displayName } from "./actors";
import {
  STATUSES,
  type Hub,
  type Item,
  type ItemEvent,
  type Person,
  type Role,
  type Status,
} from "./schema";

export interface CorrectionInput {
  status: string;
  hub: string; // hub_id, or "" to keep each card's current hub
  holder: string; // person_id, needed for pending / traveling / with_fo / with_rig
  homeHub: string; // hub_id, or "" to keep
  note: string;
}

export interface CorrectionContext {
  hubs: Hub[];
  people: Person[];
  by: string;
  now: string;
  newId: (prefix: string) => string;
}

export interface CorrectionPlan {
  events: ItemEvent[];
  items: Item[];
  unchanged: string[];
  errors: string[];
}

// Who must hold the card in each status. Other statuses have no holder.
const HOLDER_ROLE: Partial<Record<Status, Role>> = {
  pending: "im",
  traveling: "ifo",
  with_fo: "fo",
  with_rig: "rig",
  with_qc: "qc",
  with_hardware: "hardware",
};
// A card that is pending is at the receiving IM's hub. For any other holder it stays where it was unless a hub is chosen.
const HUB_FROM_HOLDER = new Set<Status>(["pending"]);

/**
 * Turns an admin correction into events plus updated item rows. Nothing is saved here,
 * and if any error is returned the caller must save nothing.
 */
export function planCorrection(
  targets: Item[],
  input: CorrectionInput,
  ctx: CorrectionContext,
): CorrectionPlan {
  const plan: CorrectionPlan = { events: [], items: [], unchanged: [], errors: [] };

  const status = input.status as Status;
  if (!STATUSES.includes(status)) plan.errors.push("Choose a status.");
  if (input.note.trim().length < 3) plan.errors.push("Add a note (at least 3 characters) explaining the correction.");

  const hubIds = new Set(ctx.hubs.map((h) => h.hub_id));
  if (input.hub && !hubIds.has(input.hub)) plan.errors.push("Unknown hub.");
  if (input.homeHub && !hubIds.has(input.homeHub)) plan.errors.push("Unknown home hub.");

  const needRole = HOLDER_ROLE[status];
  const holder = ctx.people.find((p) => p.person_id === input.holder && p.active !== "false");
  if (needRole) {
    if (!holder) plan.errors.push(`Choose who holds the item (a ${needRole.toUpperCase()}).`);
    else if (holder.role !== needRole) {
      plan.errors.push(`${holder.name} is ${holder.role.toUpperCase()}; "${status}" needs a ${needRole.toUpperCase()}.`);
    }
  }
  if (plan.errors.length) return plan;

  const note = input.note.trim();
  const batch = ctx.newId("b");
  const base = { batch_id: batch, occurred_at: ctx.now, recorded_at: ctx.now, recorded_by: ctx.by, note };

  for (const item of targets) {
    const newHolder = needRole ? holder!.person_id : "";
    const newHub =
      input.hub || (HUB_FROM_HOLDER.has(status) && holder ? holder.hub : item.current_hub);
    const newHome = input.homeHub || item.home_hub;

    const stateChanged =
      status !== item.status || newHub !== item.current_hub || newHolder !== item.current_holder;
    const homeChanged = newHome !== item.home_hub;
    if (!stateChanged && !homeChanged) {
      plan.unchanged.push(item.item_id);
      continue;
    }

    const events: ItemEvent[] = [];
    if (homeChanged) {
      events.push({
        ...base,
        event_id: ctx.newId("e"),
        item_id: item.item_id,
        action: "reassign_home_hub",
        from_person: "",
        to_person: "",
        from_id: "",
        to_id: "",
        from_hub: item.current_hub,
        hub: newHome,
        status_after: item.status,
      });
    }
    if (stateChanged) {
      events.push({
        ...base,
        event_id: ctx.newId("e"),
        item_id: item.item_id,
        action: "correct",
        from_person: displayName(ctx.people, item.current_holder),
        to_person: displayName(ctx.people, newHolder),
        from_id: item.current_holder,
        to_id: newHolder,
        from_hub: item.current_hub,
        hub: newHub,
        status_after: status,
      });
    }
    plan.events.push(...events);
    plan.items.push({
      ...item,
      status,
      current_hub: newHub,
      current_holder: newHolder,
      home_hub: newHome,
      last_event_id: events[events.length - 1].event_id,
      updated_at: ctx.now,
    });
  }
  return plan;
}
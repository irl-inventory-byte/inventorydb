import { displayName } from "./actors";
import { rigHomeHub } from "./rig-hub";
import type { Hub, Item, ItemEvent, Person, Role, Status } from "./schema";

export interface HandoverContext {
  hubs: Hub[];
  people: Person[];
  actorPersonId: string; // who did the handover: an IM's person_id, or an admin's email
  by: string; // signed-in email, always saved as recorded_by
  now: string; // IST timestamp taken when the form is saved, used for every event in the batch
  newId: (prefix: string) => string;
  /** Role of the person sending (an admin's email counts as "admin"). Sends only. */
  senderRole?: Role | "admin";
  /** Latest QC result per rig: "qc_pending" | "pass" | "fail". Sends only. */
  qcStatus?: ReadonlyMap<string, string>;
}

export interface HandoverPlan {
  events: ItemEvent[];
  items: Item[];
  errors: string[];
  mismatch?: string;
}

export interface SendInput {
  fromHub: string; // hub_id the cards are being sent from; every card must be in stock there
  recipient?: string; // person_id of who the cards are handed to. Required unless internalName is set
  internalName?: string; // a typed name for the "Internal" category, used instead of recipient
  toHub: string; // hub_id of the location the cards are going to. Always required
  note: string;
}

// What a card becomes when an IM hands it to someone of each role.
const SEND_STATUS: Partial<Record<Role, Status>> = {
  im: "pending",
  ifo: "traveling",
  fo: "with_fo",
  rig: "with_rig",
  internal: "pending", // a listed internal person works like an IM: they receive it at that hub
  qc: "pending_qc", // the QC team member must receive it (then: with QC team)
  hardware: "pending_hardware", // the hardware team member must receive it (then: with hardware team)
};

// QC and hardware teams send the rigs they are holding, not stock from a hub.
const HELD_BY: Partial<Record<Role, Status>> = { qc: "with_qc", hardware: "with_hardware" };

const QC_WORD: Record<string, string> = { qc_pending: "QC pending", pass: "Pass", fail: "Fail", repaired: "Repaired" };

// Ready for the field: QC passed, or repaired by the hardware team.
const READY_FOR_FIELD = new Set(["pass", "repaired"]);

/**
 * RIG ROUTE (SD cards are not affected):
 *   IM → QC team                    always
 *   IM → FO or IFO                  only when the rig is QC passed or repaired by hardware
 *   QC team → IM                    only when QC is Pass
 *   QC team → hardware team         only when QC is Fail
 *   QC team → another QC person     always (a transfer, no QC result)
 *   hardware team → IM              after repair (the rig is then "Repaired · Ready for field")
 * Nothing else is allowed for a rig. Returns the error messages, if any.
 */
function rigRouteErrors(
  targets: Item[],
  senderRole: Role | "admin",
  to: Role | "internal",
  qcStatus: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];
  const rigs = targets.filter((t) => t.item_type === "rig");
  const cards = targets.filter((t) => t.item_type !== "rig");
  const qc = (t: Item) => qcStatus.get(t.item_id) || "qc_pending";
  const named = (list: Item[]) => list.map((t) => `${t.item_id} (${QC_WORD[qc(t)] ?? qc(t)})`);

  if (cards.length && (to === "qc" || to === "hardware")) {
    errors.push(`Only rigs can be sent to the QC or hardware team. SD cards: ${listOf(cards.map((t) => t.item_id))}.`);
  }
  if (!rigs.length) return errors;

  if (senderRole === "qc") {
    if (to === "im") {
      const notPass = rigs.filter((t) => qc(t) !== "pass");
      if (notPass.length) errors.push(`Only QC-passed rigs can go to an IM: ${listOf(named(notPass))}. Record Pass first, or send a failed rig to the hardware team.`);
    } else if (to === "hardware") {
      const notFail = rigs.filter((t) => qc(t) !== "fail");
      if (notFail.length) errors.push(`Only QC-failed rigs go to the hardware team: ${listOf(named(notFail))}. Record Fail first.`);
    } else if (to === "qc") {
      // QC → QC transfer: hand the rig to another QC person without a result. Always allowed.
    } else {
      errors.push("The QC team can send a rig only to an IM (QC pass), to the hardware team (QC fail) or to another QC person (transfer).");
    }
    return errors;
  }

  if (senderRole === "hardware") {
    if (to !== "im") errors.push("The hardware team can send a repaired rig only to an IM.");
    return errors;
  }

  // IM (or an admin)
  if (to === "fo" || to === "ifo" || to === "internal") {
    const notReady = rigs.filter((t) => !READY_FOR_FIELD.has(qc(t)));
    if (notReady.length) errors.push(`These rigs are not ready to deploy: ${listOf(named(notReady))}. Send them to the QC team first.`);
  } else if (to !== "qc") {
    errors.push(`Rigs can only be sent to the QC team, or to an FO / IFO / internal person when QC passed or RTD: ${listOf(rigs.map((t) => t.item_id))}.`);
  }
  return errors;
}
// Cards an IM can take back into stock.
const RECEIVABLE = new Set<Status>(["pending", "traveling", "with_fo", "with_rig", "with_internal"]);

const hubName = (ctx: HandoverContext, id: string) => ctx.hubs.find((h) => h.hub_id === id)?.name ?? id;

const listOf = (ids: string[]) => (ids.length > 5 ? `${ids.slice(0, 5).join(", ")} and ${ids.length - 5} more` : ids.join(", "));

// Every event is stamped with the moment it is saved. There is no way to enter a different time.
function eventBase(ctx: HandoverContext, note: string) {
  return {
    batch_id: ctx.newId("b"),
    occurred_at: ctx.now,
    recorded_at: ctx.now,
    recorded_by: ctx.by,
    note,
  };
}

/**
 * Send in-stock cards to a person AT a location. Both are always required. The person decides the status
 * (IM = pending, IFO = traveling, FO = with FO, rig = with rig, a typed "Internal" name = with internal).
 * The location is where the cards are recorded, whichever hub the person normally belongs to.
 */
export function planSend(targets: Item[], input: SendInput, ctx: HandoverContext): HandoverPlan {
  const plan: HandoverPlan = { events: [], items: [], errors: [] };
  const activeHub = (id: string) => ctx.hubs.some((h) => h.hub_id === id && h.active !== "false");

  // A typed "Internal" name has no row in People, so it's used as-is for the holder and the display
  // name falls back to it automatically (see displayName). Otherwise the recipient must be a real,
  // active person whose role has a status.
  const internalName = (input.internalName ?? "").trim();
  let status: Status | undefined;
  let holder = "";
  let toRole: Role | "internal" | undefined;
  if (internalName) {
    status = "with_internal";
    holder = internalName;
    toRole = "internal";
  } else {
    const recipient = ctx.people.find((p) => p.person_id === input.recipient && p.active !== "false");
    status = recipient && SEND_STATUS[recipient.role];
    holder = recipient?.person_id ?? "";
    toRole = recipient?.role;
    if (!recipient || !status) plan.errors.push("Choose the person the items are going to.");
  }
  // QC and hardware teams always work at Bangalore: rigs sent to them go there, whatever was chosen.
  // The same when the QC or hardware team is SENDING (to an IM or to hardware): it stays at Bangalore.
  const senderAtBangalore = ctx.senderRole === "qc" || ctx.senderRole === "hardware";
  if (toRole === "qc" || toRole === "hardware" || senderAtBangalore) {
    const bangalore = rigHomeHub(ctx.hubs)?.hub_id;
    if (bangalore) input = { ...input, toHub: bangalore };
  }
  if (!activeHub(input.toHub)) plan.errors.push("Choose the location the items are going to.");

  const sender = ctx.senderRole ?? "im";
  const heldStatus = sender === "admin" ? undefined : HELD_BY[sender];

  if (heldStatus) {
    // QC / hardware team: only rigs they are holding right now.
    if (internalName) plan.errors.push("Choose a person from the list.");
    const notHeld = targets.filter(
      (t) => t.item_type !== "rig" || t.status !== heldStatus || t.current_holder !== ctx.actorPersonId,
    );
    if (notHeld.length) {
      plan.errors.push(`You can only send rigs that are with you (receive them first on Receive items). Not with you: ${listOf(notHeld.map((t) => t.item_id))}.`);
    }
  } else {
    if (!activeHub(input.fromHub)) {
      plan.errors.push("Choose the hub you are sending from.");
    }
    const notInStock = targets.filter((t) => t.status !== "in_stock").map((t) => `${t.item_id} (${t.status})`);
    if (notInStock.length) plan.errors.push(`Only in-stock items can be sent. Not in stock: ${listOf(notInStock)}.`);
  }

  if (toRole && status) {
    plan.errors.push(...rigRouteErrors(targets, sender, toRole, ctx.qcStatus ?? new Map()));
  }

  // Sending from a hub means the cards are in stock there. Choosing the right hub is the fix if they are not.
  const elsewhere = heldStatus
    ? []
    : targets.filter((t) => t.status === "in_stock" && t.current_hub !== input.fromHub);
  if (elsewhere.length && plan.errors.length === 0) {
    plan.errors.push(
      `Not at ${hubName(ctx, input.fromHub)}: ${listOf(elsewhere.map((t) => `${t.item_id} (at ${hubName(ctx, t.current_hub)})`))}. Choose that hub in "Sending from".`,
    );
  }
  if (plan.errors.length || !status) return plan;
  const sendStatus: Status = status;

  const base = eventBase(ctx, input.note.trim());
  for (const item of targets) {
    const hub = input.toHub;
    // A rig checked out to an internal person (e.g. a demo rig) is "With internal", not waiting to be received.
    const status = item.item_type === "rig" && toRole === "internal" ? "with_internal" : sendStatus;
    const event: ItemEvent = {
      ...base,
      event_id: ctx.newId("e"),
      item_id: item.item_id,
      action: "check_out",
      from_person: displayName(ctx.people, ctx.actorPersonId),
      to_person: displayName(ctx.people, holder),
      from_id: ctx.actorPersonId,
      to_id: holder,
      from_hub: heldStatus ? item.current_hub : input.fromHub,
      hub,
      status_after: status,
    };
    plan.events.push(event);
    plan.items.push({
      ...item,
      status,
      current_hub: hub,
      current_holder: holder,
      last_event_id: event.event_id,
      updated_at: ctx.now,
    });
  }
  return plan;
}

// QC / hardware team: what they can receive, and what it becomes once received.
const RECEIVE_HELD: Partial<Record<Role, { from: Status; to: Status }>> = {
  qc: { from: "pending_qc", to: "with_qc" },
  hardware: { from: "pending_hardware", to: "with_hardware" },
};

/** True when this role receives rigs sent to them (QC, hardware) instead of taking items into stock. */
export const receivesHeld = (role: Role | "admin" | undefined) => !!role && role !== "admin" && !!RECEIVE_HELD[role];

/**
 * QC or hardware team member receives the rigs sent to THEM. The rig stays at the hub it was sent to and
 * becomes "With QC team" / "With hardware team" under their name.
 */
export function planReceiveHeld(targets: Item[], input: { note: string }, ctx: HandoverContext): HandoverPlan {
  const plan: HandoverPlan = { events: [], items: [], errors: [] };
  const rule = ctx.senderRole && ctx.senderRole !== "admin" ? RECEIVE_HELD[ctx.senderRole] : undefined;
  if (!rule) {
    plan.errors.push("Only the QC or hardware team can receive rigs this way.");
    return plan;
  }
  const wrong = targets.filter(
    (t) => t.item_type !== "rig" || t.status !== rule.from || t.current_holder !== ctx.actorPersonId,
  );
  if (wrong.length) {
    plan.errors.push(`These rigs were not sent to you, or are already received: ${listOf(wrong.map((t) => t.item_id))}.`);
    return plan;
  }

  const base = eventBase(ctx, input.note.trim());
  for (const item of targets) {
    const event: ItemEvent = {
      ...base,
      event_id: ctx.newId("e"),
      item_id: item.item_id,
      action: "receive",
      from_person: displayName(ctx.people, item.current_holder),
      to_person: displayName(ctx.people, ctx.actorPersonId),
      from_id: item.current_holder,
      to_id: ctx.actorPersonId,
      from_hub: item.current_hub,
      hub: item.current_hub,
      status_after: rule.to,
    };
    plan.events.push(event);
    plan.items.push({ ...item, status: rule.to, last_event_id: event.event_id, updated_at: ctx.now });
  }
  return plan;
}

/** An IM takes cards back into stock at a hub. `expected` (optional) flags a count mismatch. */
export function planReceive(
  targets: Item[],
  input: { hub: string; note: string; expected?: number },
  ctx: HandoverContext,
): HandoverPlan {
  const plan: HandoverPlan = { events: [], items: [], errors: [] };
  if (!ctx.hubs.some((h) => h.hub_id === input.hub && h.active !== "false")) plan.errors.push("Choose the receiving hub.");
  const wrong = targets.filter((t) => !RECEIVABLE.has(t.status)).map((t) => `${t.item_id} (${t.status})`);
  if (wrong.length) plan.errors.push(`These items are not waiting to be received: ${listOf(wrong)}.`);

  // A card sent to a hub must be received at that hub, otherwise it could silently land in the wrong stock
  // (e.g. 50 sent, only 40 ever show up received, with the other 10 unnoticed in the wrong place). This
  // applies to IM, IFO and the rig team - all hub-to-hub style movements. A card with an FO has no fixed
  // hub (an IM collects it back wherever that FO happens to be), and Internal needs no handshake at all,
  // so neither is locked to a hub.
  const HUB_LOCKED: ReadonlySet<Status> = new Set(["pending", "traveling", "with_rig"]);
  const elsewhere = targets.filter((t) => HUB_LOCKED.has(t.status) && t.current_hub !== input.hub);
  if (elsewhere.length) {
    plan.errors.push(
      `Sent to a different hub: ${listOf(elsewhere.map((t) => `${t.item_id} (to ${hubName(ctx, t.current_hub)})`))}. Receive them at that hub, not ${hubName(ctx, input.hub)}.`,
    );
  }
  if (plan.errors.length) return plan;

  if (input.expected !== undefined && input.expected !== targets.length) {
    plan.mismatch = `Mismatch: expected ${input.expected}, received ${targets.length}.`;
  }
  const note = [plan.mismatch, input.note.trim()].filter(Boolean).join(" ");
  const base = eventBase(ctx, note);
  for (const item of targets) {
    const event: ItemEvent = {
      ...base,
      event_id: ctx.newId("e"),
      item_id: item.item_id,
      action: "receive",
      from_person: displayName(ctx.people, item.current_holder),
      to_person: displayName(ctx.people, ctx.actorPersonId),
      from_id: item.current_holder,
      to_id: ctx.actorPersonId,
      from_hub: item.current_hub,
      hub: input.hub,
      status_after: "in_stock",
    };
    plan.events.push(event);
    plan.items.push({
      ...item,
      status: "in_stock",
      current_hub: input.hub,
      current_holder: "",
      last_event_id: event.event_id,
      updated_at: ctx.now,
    });
  }
  return plan;
}
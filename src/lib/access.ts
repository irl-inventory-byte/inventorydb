import type { Item, Role } from "./schema";
import { getStore } from "./store";

/**
 * WHO CAN SEE AND DO WHAT. Change access here; every page uses these rules.
 *
 *              SD cards   Rigs   Mobiles   Send/receive   Add items   Hardware   QC
 *   Admin        yes      yes     yes         yes           yes        yes      yes
 *   IM           yes      yes     yes         yes           yes        yes      yes
 *   FO           yes      yes     yes          -             -          -        -
 *   Rig team     yes       -       -          yes           yes         -        -
 *   IFO          yes       -      yes          -             -          -        -
 *   Hardware      -       yes      -        send only       -         yes       -
 *   QC            -       yes      -        send only       -          -       yes
 *   Internal     yes      yes      -          yes           -          -        -   (works like an IM for send / receive)
 *
 * Mobiles: Admin and IM add them (scan the IMEI; details load from the mobile sheet). They are sent and
 * received like SD cards, but only between IMs, FOs and IFOs (the rig, internal, QC and hardware teams don't
 * hand them over). The internal team can see mobiles. They never show in SD card or rig counts.
 *
 * Rig route: IM → QC team. QC pass → IM; QC fail → hardware team → IM → QC again.
 * An IM can send a rig to an FO or IFO only when its latest QC result is Pass.
 */

export const ITEM_TYPES = ["sd_card", "rig", "mobile"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** SD cards and rigs (e.g. for views that are only about them). */
export const CORE_TYPES: readonly ItemType[] = ["sd_card", "rig"];

/** Can add mobiles. */
export const MOBILE_ADD_ROLES: Role[] = ["admin", "im"];

const TYPES_FOR: Record<Role, readonly ItemType[]> = {
  admin: ["sd_card", "rig", "mobile"],
  im: ["sd_card", "rig", "mobile"],
  fo: ["sd_card", "rig", "mobile"],
  rig: ["sd_card"],
  ifo: ["sd_card", "mobile"],
  hardware: ["rig"],
  qc: ["rig"],
  internal: ["sd_card", "rig", "mobile"], // internal team: works like an IM for send / receive; sees mobiles too
};

/** Every role that can sign in and look around (dashboard, inventory, receipts). */
export const VIEW_ROLES: Role[] = ["admin", "im", "fo", "rig", "hardware", "qc", "internal"];
/** Sees the Inventory list (tile and Dashboard tab). Hardware and Internal teams do not. */
export const INVENTORY_ROLES: Role[] = ["admin", "im", "fo", "rig", "qc"];
/** Can send and receive items, and see My dashboard. */
export const HANDLER_ROLES: Role[] = ["admin", "im", "rig", "internal"];
/** Can open My dashboard. */
export const MY_DASHBOARD_ROLES: Role[] = ["admin", "im", "rig", "qc", "hardware", "internal"];
/** Can open Receive items. QC and hardware teams receive only rigs sent to them (lib/handover.ts). */
export const RECEIVE_ROLES: Role[] = ["admin", "im", "rig", "qc", "hardware", "internal"];
/** Can open Send items. QC and hardware teams send only rigs they hold (rules in lib/handover.ts). */
export const SEND_ROLES: Role[] = ["admin", "im", "rig", "qc", "hardware", "internal"];
/** Can add new items to the inventory. */
export const ADD_ROLES: Role[] = ["admin", "im", "rig"];
/** Can record hardware updates on a rig. */
export const HARDWARE_ROLES: Role[] = ["admin", "im", "hardware"];
/** Can record QC results on a rig. */
export const QC_ROLES: Role[] = ["admin", "im", "qc"];

/** An item's type. Older rows without a type are SD cards. */
export function itemType(item: Pick<Item, "item_type">): ItemType {
  return item.item_type === "rig" ? "rig" : item.item_type === "mobile" ? "mobile" : "sd_card";
}

/** The item types this role may see, in display order. */
export function allowedTypes(role: Role | undefined): readonly ItemType[] {
  return (role && TYPES_FOR[role]) || [];
}

export function canSeeType(role: Role | undefined, type: ItemType): boolean {
  return allowedTypes(role).includes(type);
}

/**
 * The store as this role sees it: items and events of other types are
 * hidden everywhere (lists, lookups, scans, history).
 *
 * `only` narrows further to one type (the "SD cards / Rigs / Mobiles" switch),
 * and is ignored if the role may not see that type.
 */
export function storeFor(role: Role | undefined, only?: string) {
  const allowed = allowedTypes(role);
  const narrowed =
    only && (allowed as readonly string[]).includes(only)
      ? [only as ItemType]
      : allowed;
  return getStore().forTypes(narrowed);
}

/** Every type this role may see (same as storeFor without a type). */
/**
 * The store for Send and Receive: like storeFor, but the internal team can't hand over mobiles (they only
 * see them on the dashboard and receipts).
 */
export function handoverStoreFor(role: Role | undefined) {
  const types = allowedTypes(role).filter((t) => !(role === "internal" && t === "mobile"));
  return getStore().forTypes(types);
}

export function storeForAll(role: Role | undefined) {
  return getStore().forTypes(allowedTypes(role));
}

/** Reads ?type= from the address bar: "sd_card", "rig", "mobile" or "" for all. */
export function typeParam(value: string | undefined, role: Role | undefined): ItemType | "" {
  return value && canSeeType(role, value as ItemType) ? (value as ItemType) : "";
}
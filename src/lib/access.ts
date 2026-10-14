import type { Item, Role } from "./schema";
import { getStore } from "./store";

/**
 * WHO CAN SEE AND DO WHAT. Change access here; every page uses these rules.
 *
 *              SD cards   Rigs   Send/receive   Add items   Hardware   QC
 *   Admin        yes      yes        yes           yes        yes      yes
 *   IM           yes      yes        yes           yes        yes      yes
 *   FO           yes      yes         -             -          -        -
 *   Rig team     yes       -         yes           yes         -        -
 *   IFO          yes       -          -             -          -        -
 *   Hardware      -       yes      send only       -         yes       -
 *   QC            -       yes      send only       -          -       yes
 *
 * Rig route: IM → QC team. QC pass → IM; QC fail → hardware team → IM → QC again.
 * An IM can send a rig to an FO or IFO only when its latest QC result is Pass.
 */

export const ITEM_TYPES = ["sd_card", "rig"] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

const TYPES_FOR: Record<Role, readonly ItemType[]> = {
  admin: ["sd_card", "rig"],
  im: ["sd_card", "rig"],
  fo: ["sd_card", "rig"],
  rig: ["sd_card"],
  ifo: ["sd_card"],
  hardware: ["rig"],
  qc: ["rig"],
};

/** Every role that can sign in and look around (dashboard, inventory, receipts). */
export const VIEW_ROLES: Role[] = ["admin", "im", "fo", "rig", "hardware", "qc"];
/** Can send and receive items, and see My dashboard. */
export const HANDLER_ROLES: Role[] = ["admin", "im", "rig"];
/** Can open My dashboard. */
export const MY_DASHBOARD_ROLES: Role[] = ["admin", "im", "rig", "qc", "hardware"];
/** Can open Send items. QC and hardware teams send only rigs they hold (rules in lib/handover.ts). */
export const SEND_ROLES: Role[] = ["admin", "im", "rig", "qc", "hardware"];
/** Can add new items to the inventory. */
export const ADD_ROLES: Role[] = ["admin", "im", "rig"];
/** Can record hardware updates on a rig. */
export const HARDWARE_ROLES: Role[] = ["admin", "im", "hardware"];
/** Can record QC results on a rig. */
export const QC_ROLES: Role[] = ["admin", "im", "qc"];

/** An item's type. Older rows without a type are SD cards. */
export function itemType(item: Pick<Item, "item_type">): ItemType {
  return item.item_type === "rig" ? "rig" : "sd_card";
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
 * `only` narrows further to one type (the "SD cards / Rigs" switch),
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

/** Reads ?type= from the address bar: "sd_card", "rig" or "" for all. */
export function typeParam(value: string | undefined, role: Role | undefined): ItemType | "" {
  return value && canSeeType(role, value as ItemType) ? (value as ItemType) : "";
}
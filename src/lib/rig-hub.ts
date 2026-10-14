import type { Hub } from "./schema";

/**
 * Rigs always have Bangalore as their home hub.
 * The hub is found by its ID or name "Bangalore" (any letter case), like the People page does.
 */
export function rigHomeHub(hubs: Pick<Hub, "hub_id" | "name" | "active">[]) {
  const active = hubs.filter((h) => h.active !== "false");
  const is = (v: string) => (v ?? "").trim().toLowerCase() === "bangalore";
  return active.find((h) => is(h.hub_id)) ?? active.find((h) => is(h.name));
}
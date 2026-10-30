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

/**
 * The rig team's own location: a hub whose ID or name starts with "rig team" (any letter case, spaces,
 * underscores and hyphens all ignored) — so "Rig team", "rig_team" and "Rig_team_BLR" all match.
 * undefined if no such hub has been added yet (Manage hubs → + Add a hub).
 */
export function rigTeamHub(hubs: Pick<Hub, "hub_id" | "name" | "active">[]) {
  const active = hubs.filter((h) => h.active !== "false");
  const norm = (v: string) => (v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const is = (v: string) => norm(v).startsWith("rigteam");
  return active.find((h) => is(h.hub_id)) ?? active.find((h) => is(h.name));
}
/** The home hub of every mobile: "Instawork Robotics Labs" (by ID or name, any letter case). */
export const MOBILE_HUB_NAME = "Instawork Robotics Labs";
export function mobileHomeHub(hubs: Pick<Hub, "hub_id" | "name" | "active">[]) {
  const active = hubs.filter((h) => h.active !== "false");
  const norm = (v: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(MOBILE_HUB_NAME);
  return active.find((h) => norm(h.name) === want || norm(h.hub_id) === want) ?? active.find((h) => norm(h.name).includes(want));
}
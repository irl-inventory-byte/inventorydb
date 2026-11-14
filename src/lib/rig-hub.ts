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

/**
 * Every rig team hub, across every city — e.g. "Rig_team_BLR", "Rig_team_Indore". Same matching rule as
 * rigTeamHub (ID or name starts with "rig team", case/space/underscore/hyphen insensitive), but returns
 * all matches instead of just the first, for views that break rig-team stock down by city.
 */
export function rigTeamHubs(hubs: Pick<Hub, "hub_id" | "name" | "active">[]) {
  const active = hubs.filter((h) => h.active !== "false");
  const norm = (v: string) => (v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const is = (h: Pick<Hub, "hub_id" | "name">) => norm(h.hub_id).startsWith("rigteam") || norm(h.name).startsWith("rigteam");
  return active.filter(is);
}

/**
 * The productivity team's own location: a hub whose ID or name starts with "productivity" (any letter
 * case, spaces, underscores and hyphens ignored) — so "Productivity team", "productivity_team" AND
 * "Productivity_BLR" all match (the "team" part is not required, since real hubs are often named
 * "Productivity_<city>" rather than "Productivity team ..."). undefined if no such hub exists yet.
 */
export function productivityTeamHub(hubs: Pick<Hub, "hub_id" | "name" | "active">[]) {
  const active = hubs.filter((h) => h.active !== "false");
  const norm = (v: string) => (v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const is = (v: string) => norm(v).startsWith("productivity");
  return active.find((h) => is(h.hub_id)) ?? active.find((h) => is(h.name));
}

/**
 * Every productivity team hub, across every city — e.g. "Productivity_BLR", "Productivity_Indore". Same
 * matching rule as productivityTeamHub, but returns all matches instead of just the first, for views that
 * break productivity-team stock down by city.
 */
export function productivityTeamHubs(hubs: Pick<Hub, "hub_id" | "name" | "active">[]) {
  const active = hubs.filter((h) => h.active !== "false");
  const norm = (v: string) => (v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const is = (h: Pick<Hub, "hub_id" | "name">) => norm(h.hub_id).startsWith("productivity") || norm(h.name).startsWith("productivity");
  return active.filter(is);
}

/** The home hub of every mobile: "Instawork Robotics Labs" (by ID or name, any letter case). */
export const MOBILE_HUB_NAME = "Instawork Robotics Labs";
export function mobileHomeHub(hubs: Pick<Hub, "hub_id" | "name" | "active">[]) {
  const active = hubs.filter((h) => h.active !== "false");
  const norm = (v: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = norm(MOBILE_HUB_NAME);
  return active.find((h) => norm(h.name) === want || norm(h.hub_id) === want) ?? active.find((h) => norm(h.name).includes(want));
}
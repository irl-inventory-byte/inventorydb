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
 * Every hub whose ID or name starts with "rig team" — not just the first one. There can be more than
 * one (one per city, e.g. "Rig team BLR" and "Rig team Delhi"), and code that COUNTS items (rather than
 * picking one default hub to send to) must check every one of them, or items sitting at every hub but
 * the first are silently dropped from the rig team's count and double-counted as plain "In stock"
 * instead. See dashboard/page.tsx's "With rig team" tile for where that mattered.
 */
export function rigTeamHubs(hubs: Pick<Hub, "hub_id" | "name" | "active">[]) {
  const active = hubs.filter((h) => h.active !== "false");
  const norm = (v: string) => (v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const is = (h: Pick<Hub, "hub_id" | "name">) => norm(h.hub_id).startsWith("rigteam") || norm(h.name).startsWith("rigteam");
  return active.filter(is);
}

/**
 * The productivity team's own location: a hub whose ID or name starts with "productivity team" (any letter
 * case, spaces, underscores and hyphens all ignored) — so "Productivity team", "productivity_team" and
 * "Productivity_team_BLR" all match. undefined if no such hub has been added yet (Manage hubs → + Add a hub).
 */
export function productivityTeamHub(hubs: Pick<Hub, "hub_id" | "name" | "active">[]) {
  const active = hubs.filter((h) => h.active !== "false");
  const norm = (v: string) => (v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const is = (v: string) => norm(v).startsWith("productivityteam");
  return active.find((h) => is(h.hub_id)) ?? active.find((h) => is(h.name));
}

/** Same idea as rigTeamHubs, but for every "productivity team" hub (see rigTeamHubs' comment). */
export function productivityTeamHubs(hubs: Pick<Hub, "hub_id" | "name" | "active">[]) {
  const active = hubs.filter((h) => h.active !== "false");
  const norm = (v: string) => (v ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const is = (h: Pick<Hub, "hub_id" | "name">) => norm(h.hub_id).startsWith("productivityteam") || norm(h.name).startsWith("productivityteam");
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
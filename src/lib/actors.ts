import type { AppUser, Person, Role } from "./schema";

export interface ActorOption {
  value: string; // an IM's person_id, or an admin's email
  label: string;
}

/**
 * Who can be named as the person sending or receiving: every active IM or rig team member, plus every
 * active admin who is not already covered by a linked entry. The signed-in account is always recorded
 * separately as `recorded_by`, so naming someone else here never hides who really did it.
 */
const ACTOR_LABEL: Partial<Record<Role, string>> = { im: "IM", rig: "Rig", qc: "QC", hardware: "Hardware", internal: "Internal" };

export function actorOptions(
  people: Person[],
  users: AppUser[],
  hubName: (hubId: string) => string,
  roles: readonly Role[] = ["im", "rig"], // Send items also allows "qc" and "hardware"
): ActorOption[] {
  const handlers = people
    .filter((p) => roles.includes(p.role) && p.active !== "false")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ value: p.person_id, label: `${p.name} (${ACTOR_LABEL[p.role] ?? p.role}, ${hubName(p.hub)})` }));

  const linked = new Set(people.map((p) => p.person_id));
  const admins = users
    .filter((u) => u.role === "admin" && u.active !== "false" && !(u.person_id && linked.has(u.person_id)))
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((u) => ({ value: u.email.toLowerCase(), label: `${u.email} (Admin)` }));

  return [...handlers, ...admins];
}

/** A person's name for the sheet, so the log reads without lookups. An admin's email stays as it is. */
export function displayName(people: Person[], id: string): string {
  return id ? (people.find((p) => p.person_id === id)?.name ?? id) : "";
}

/** The signed-in user as an actor value: their linked person, or their email if they have none. */
export function defaultActor(user: { personId?: string; email?: string | null }): string {
  return user.personId || (user.email ?? "").toLowerCase();
}

/**
 * Who this user may record a handover as. An admin can pick anyone on the list and act on their behalf.
 * Everyone else is tied to their own linked IM record, whatever the form says.
 */
export function allowedActors(
  user: { role: Role; personId?: string; email?: string | null },
  options: ActorOption[],
): ActorOption[] {
  if (user.role === "admin") return options;
  const mine = defaultActor(user);
  return options.filter((o) => o.value === mine);
}

/** The value if it is one of the allowed options, otherwise undefined. */
export function resolveActor(value: string, options: ActorOption[]): string | undefined {
  return options.find((o) => o.value === value)?.value;
}
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
const ACTOR_LABEL: Partial<Record<Role, string>> = { im: "IM", rig: "Rig", qc: "QC", hardware: "Hardware", internal: "Internal", ic: "IC" };

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

  // Only treat an admin as "already covered" when their linked person is actually one of the roles
  // being listed here (e.g. "ic") — being linked to some unrelated person (an FO, a QC, etc.) must
  // not hide the admin's own email from this list, or they'd have no way to act as themselves.
  const linked = new Set(handlers.map((h) => h.value));
  const admins = users
    .filter((u) => u.role === "admin" && u.active !== "false" && !(u.person_id && linked.has(u.person_id)))
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((u) => ({ value: u.email.toLowerCase(), label: `${u.email} (Admin)` }));

  // IC fallback, same idea as the admin one above, gated to only when "ic" was actually asked for
  // (today that's only app/ic/transfer/page.tsx, via its actorRoles: ["ic"]) so no other page's actor
  // list changes. Unlike IM/rig/QC/hardware/internal, an IC login isn't always linked to a People row —
  // this is literally the login used by an Admin's "Transfer to FO" flow too, often unlinked — and
  // without this, an unlinked-but-active IC account couldn't appear here at all: the page would show
  // "Your login is not linked to an active person in People" AND, if that check were bypassed in the UI
  // alone, the server-side resolveActor() in handover/actions.ts (same actorOptions lookup) would still
  // reject the transfer, since there'd be no matching entry for their email either way.
  const icUsers = roles.includes("ic")
    ? users
        .filter((u) => u.role === "ic" && u.active !== "false" && !(u.person_id && linked.has(u.person_id)))
        .sort((a, b) => a.email.localeCompare(b.email))
        .map((u) => ({ value: u.email.toLowerCase(), label: `${u.email} (IC)` }))
    : [];

  return [...handlers, ...admins, ...icUsers];
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
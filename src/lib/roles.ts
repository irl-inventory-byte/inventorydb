import type { AppUser, Person, Role } from "./schema";

/**
 * PRIMARY AND SECONDARY ROLE
 *
 * Every login has a primary role (the "role" column in the users tab, required). An admin may also give a
 * login ONE secondary role ("secondary_role" column, optional). The person can then switch between the two
 * at any time (Home or Dashboard → "Switch to …"). The app then works exactly as if they had that role:
 * menus, pages, what they can send or receive, and the rig rules.
 *
 * Examples: Ashish — primary Admin, secondary QC. An IM who also does QC — primary IM, secondary QC.
 *
 * The chosen role is kept in a cookie on that browser. It is only honoured if it is the login's primary or
 * secondary role, so nobody can give themselves a role by editing the cookie.
 */
export const ACTIVE_ROLE_COOKIE = "active_role";

// Roles that work through a person in the People tab (handovers are recorded under that person).
export const ROLES_NEEDING_PERSON: readonly Role[] = ["im", "rig", "qc", "hardware", "internal", "fo"];

/** The role the app should use now: the secondary role if it was chosen, otherwise the primary role. */
export function activeRole(primary: Role, secondary: Role | undefined, chosen: string | undefined): Role {
  return secondary && secondary !== primary && chosen === secondary ? secondary : primary;
}

/** Secondary role per linked person (active logins only), e.g. Map { "P-ASHISH" → "qc" }. */
export function secondaryByPerson(users: AppUser[]): Map<string, Role> {
  const map = new Map<string, Role>();
  for (const u of users) {
    const sec = (u.secondary_role ?? "") as Role | "";
    if (u.active !== "false" && u.person_id && sec && sec !== u.role) map.set(u.person_id, sec);
  }
  return map;
}

/** True if this person can act as `role`: it is their People role, or their login's secondary role. */
export function personHasRole(person: Person, role: string, secondary: Map<string, Role>): boolean {
  return person.role === role || secondary.get(person.person_id) === role;
}

/**
 * The People list as it should be seen for ONE handover:
 *   - the person doing it (`actor`) takes the role they are acting in right now;
 *   - the person it is sent to takes the category it was chosen under (e.g. "QC team"), but only if that
 *     is their People role or their secondary role. Anything else is ignored.
 * Nothing is saved: this only decides the rules and statuses for this handover.
 */
export function peopleActingAs(
  people: Person[],
  users: AppUser[],
  opts: { actor?: string; actorRole?: Role; recipient?: string; recipientRole?: string },
): Person[] {
  const secondary = secondaryByPerson(users);
  return people.map((p) => {
    if (opts.actor && p.person_id === opts.actor && opts.actorRole && opts.actorRole !== "admin") {
      return { ...p, role: opts.actorRole };
    }
    if (opts.recipient && p.person_id === opts.recipient && opts.recipientRole && personHasRole(p, opts.recipientRole, secondary)) {
      return { ...p, role: opts.recipientRole as Role };
    }
    return p;
  });
}
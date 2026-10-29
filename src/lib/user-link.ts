import type { Person } from "./schema";

export type LoginRole = "admin" | "im" | "rig" | "fo" | "hardware" | "qc" | "internal";

// The person role a login role must be linked to. An admin login may be linked to anyone, or no one.
const NEEDS: Partial<Record<LoginRole, Person["role"]>> = { im: "im", rig: "rig", internal: "internal" };
// Logins that MAY be linked to a person of the same role, but don't have to be.
const MAY_LINK: Partial<Record<LoginRole, Person["role"]>> = { fo: "fo", hardware: "hardware", qc: "qc" };

/**
 * The person a login acts as. A valid link saved on the login wins. If it is blank (for example the logins
 * were added in bulk), an IM or Rig login is matched to the active person of that role whose email in the
 * People tab equals the login's email. Returns "" when there is no link, such as an admin without one.
 */
export function resolveLinkedPerson(
  user: { email: string; role: LoginRole; person_id: string },
  people: Person[],
): string {
  const saved = user.person_id ? checkUserLink(user.role, user.person_id, people) : undefined;
  if (saved) return saved;
  const need = NEEDS[user.role] ?? MAY_LINK[user.role];
  if (!need) return "";
  const email = user.email.toLowerCase();
  return people.find((p) => p.active !== "false" && p.role === need && p.linked_user.toLowerCase() === email)?.person_id ?? "";
}

/**
 * Checks the person a login is linked to. A linked person is optional for every role ("" = not linked; an
 * IM or Rig login is then matched by email to their People entry when they send or receive). When one is
 * chosen, it must be an active person of the same role (an IM login → an IM, a Rig login → a rig team member).
 * Returns the person_id to store, or undefined if the link is not allowed.
 */
export function checkUserLink(role: LoginRole, personId: string, people: Person[]): string | undefined {
  const need = NEEDS[role];
  const may = MAY_LINK[role];
  if (!personId) return "";
  const person = people.find((p) => p.person_id === personId && p.active !== "false");
  if (!person) return undefined;
  const required = need ?? may;
  return required && person.role !== required ? undefined : personId;
}
const ROLE_NAME: Record<string, string> = {
  admin: "Admin",
  im: "IM",
  rig: "Rig team",
  fo: "FO",
  ifo: "IFO",
  hardware: "Hardware",
  qc: "QC",
  internal: "Internal",
};

/**
 * Why a login has no linked person, in plain words for the person and their admin, or "" if it is linked.
 * `role` is the role the login is acting in (QC, hardware, …).
 */
export function linkProblem(
  user: { email: string; person_id: string } | undefined,
  role: LoginRole,
  people: Person[],
): string {
  if (!user) return "This login is not on Manage users. Ask an admin to add it.";
  if (resolveLinkedPerson({ ...user, role }, people)) return "";
  const need = NEEDS[role] ?? MAY_LINK[role];
  const roleName = need ? ROLE_NAME[need] : ROLE_NAME[role] ?? role;
  if (user.person_id) {
    const person = people.find((p) => p.person_id === user.person_id);
    if (!person) {
      return `This login is linked to a person who is no longer in People (${user.person_id}). An admin should choose the linked person again on Manage users.`;
    }
    if (person.active === "false") {
      return `This login is linked to ${person.name}, who is marked inactive in People. An admin should make ${person.name} active, or link another person on Manage users.`;
    }
    if (need && person.role !== need) {
      return `This login is linked to ${person.name}, whose role in People is ${ROLE_NAME[person.role] ?? person.role}, not ${roleName}. An admin should change ${person.name}'s role to ${roleName} in People, or link a ${roleName} person on Manage users.`;
    }
    return "";
  }
  const email = user.email.toLowerCase();
  const sameEmail = people.filter((p) => p.linked_user.toLowerCase() === email);
  const wrongRole = sameEmail.find((p) => need && p.role !== need);
  if (wrongRole && !sameEmail.some((p) => p.role === need && p.active !== "false")) {
    return `${wrongRole.name} in People has this login's email (${user.email}), but their role there is ${ROLE_NAME[wrongRole.role] ?? wrongRole.role}, not ${roleName}. An admin should change the role to ${roleName} in People, or set the Linked person on Manage users.`;
  }
  const inactive = sameEmail.find((p) => p.active === "false");
  if (inactive) {
    return `${inactive.name} in People has this login's email but is marked inactive. An admin should make them active.`;
  }
  return `No ${roleName} person in People has this login's email (${user.email}). An admin should set this login's Linked person on Manage users, or add ${user.email} as the email of the right ${roleName} person in People.`;
}

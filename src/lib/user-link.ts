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
 * Checks the person a login is linked to. An IM login must link to an active IM and a Rig login to an
 * active rig team member, so a login's name and hub always come from the right kind of person.
 * Returns the person_id to store ("" for an unlinked admin), or undefined if the link is not allowed.
 */
export function checkUserLink(role: LoginRole, personId: string, people: Person[]): string | undefined {
  const need = NEEDS[role];
  const may = MAY_LINK[role];
  if (!personId) return need ? undefined : "";
  const person = people.find((p) => p.person_id === personId && p.active !== "false");
  if (!person) return undefined;
  const required = need ?? may;
  return required && person.role !== required ? undefined : personId;
}
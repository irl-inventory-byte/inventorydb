import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, normalizeRole } from "@/auth";
import { ACTIVE_ROLE_COOKIE, activeRole } from "./roles";
import type { Role } from "./schema";
import { getStore } from "./store";
import { resolveLinkedPerson, type LoginRole } from "./user-link";

/**
 * The login's roles as they are in the users tab NOW, so a role an admin changes (primary or secondary)
 * applies straight away, without signing out. Falls back to the roles saved at sign-in if the tab can't be read.
 */
async function currentRoles(
  email: string | null | undefined,
  atSignIn: { role: Role; secondaryRole?: Role; personId?: string },
): Promise<{ role: Role; secondaryRole?: Role; personId?: string }> {
  try {
    const store = getStore();
    const row = (await store.list("users")).find(
      (u) => u.email.toLowerCase() === String(email ?? "").toLowerCase() && u.active !== "false",
    );
    const primary = normalizeRole(row?.role);
    if (!row || !primary) return atSignIn;
    const secondary = normalizeRole(row.secondary_role);
    // The linked person NOW too, so a link set on the Users page works without signing out.
    const people = await store.list("people");
    // If there is no link for the primary role, the second role may find one by email
    // (e.g. an Admin who is also QC: the QC person in People whose email is this login).
    const personId =
      resolveLinkedPerson({ ...row, role: primary as LoginRole }, people) ||
      (secondary ? resolveLinkedPerson({ ...row, role: secondary as LoginRole, person_id: "" }, people) : "");
    return { role: primary, secondaryRole: secondary && secondary !== primary ? secondary : undefined, personId };
  } catch {
    return atSignIn;
  }
}

/**
 * Use at the top of server pages and actions. Redirects if not signed in or not allowed.
 * `role` is the role the person is acting in right now: their primary role, or their secondary role if
 * they switched to it (see lib/roles.ts). `primaryRole` and `secondaryRole` are their two roles, read from the
 * users tab on each request (cached for a few seconds), so changes on the Users page apply immediately.
 */
export async function requireRole(...roles: Role[]) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const live = await currentRoles(session.user.email, session.user);
  const primaryRole = live.role;
  const secondaryRole = live.secondaryRole;
  const chosen = (await cookies()).get(ACTIVE_ROLE_COOKIE)?.value;
  const role = activeRole(primaryRole, secondaryRole, chosen);
  if (roles.length && !roles.includes(role)) redirect("/?denied=1");
  return { ...session.user, personId: live.personId ?? session.user.personId, role, primaryRole, secondaryRole };
}
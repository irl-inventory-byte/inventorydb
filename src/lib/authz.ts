import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, normalizeRole } from "@/auth";
import { ACTIVE_ROLE_COOKIE, activeRole } from "./roles";
import type { Role } from "./schema";
import { getStore } from "./store";

/**
 * The login's roles as they are in the users tab NOW, so a role an admin changes (primary or secondary)
 * applies straight away, without signing out. Falls back to the roles saved at sign-in if the tab can't be read.
 */
async function currentRoles(email: string | null | undefined, atSignIn: { role: Role; secondaryRole?: Role }) {
  try {
    const row = (await getStore().list("users")).find(
      (u) => u.email.toLowerCase() === String(email ?? "").toLowerCase() && u.active !== "false",
    );
    const primary = normalizeRole(row?.role);
    if (!primary) return atSignIn;
    const secondary = normalizeRole(row?.secondary_role);
    return { role: primary, secondaryRole: secondary && secondary !== primary ? secondary : undefined };
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
  return { ...session.user, role, primaryRole, secondaryRole };
}
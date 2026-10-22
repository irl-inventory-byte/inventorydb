import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ACTIVE_ROLE_COOKIE, activeRole } from "./roles";
import type { Role } from "./schema";

/**
 * Use at the top of server pages and actions. Redirects if not signed in or not allowed.
 * `role` is the role the person is acting in right now: their primary role, or their secondary role if
 * they switched to it (see lib/roles.ts). `primaryRole` and `secondaryRole` are their two roles.
 */
export async function requireRole(...roles: Role[]) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const primaryRole = session.user.role;
  const secondaryRole = session.user.secondaryRole;
  const chosen = (await cookies()).get(ACTIVE_ROLE_COOKIE)?.value;
  const role = activeRole(primaryRole, secondaryRole, chosen);
  if (roles.length && !roles.includes(role)) redirect("/?denied=1");
  return { ...session.user, role, primaryRole, secondaryRole };
}
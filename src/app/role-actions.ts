"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/authz";
import { ACTIVE_ROLE_COOKIE } from "@/lib/roles";

/** Switch between the login's primary and secondary role. Any other value is ignored. */
export async function switchRole(formData: FormData) {
  const user = await requireRole();
  const to = String(formData.get("role") ?? "");
  const back = String(formData.get("back") ?? "/");
  const jar = await cookies();
  if (user.secondaryRole && to === user.secondaryRole) {
    jar.set(ACTIVE_ROLE_COOKIE, to, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 30 });
  } else {
    jar.delete(ACTIVE_ROLE_COOKIE); // back to the primary role
  }
  // Only go back to a page of this app.
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : "/");
}
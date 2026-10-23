"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { checkUserLink, type LoginRole } from "@/lib/user-link";
import type { Role } from "@/lib/schema";

const UserInput = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(["admin", "im", "rig", "fo", "hardware", "qc", "internal"]), // primary role, required
  secondary: z.enum(["", "admin", "im", "rig", "fo", "hardware", "qc", "internal"]), // optional
  person: z.string(),
});

// Back to the Users page with the same filters (only these are kept), plus a message.
function backTo(formData: FormData, extra: Record<string, string>): string {
  const from = new URLSearchParams(String(formData.get("back") ?? ""));
  const keep: Record<string, string> = {};
  for (const k of ["q", "frole", "fstatus"]) if (from.get(k)) keep[k] = from.get(k)!;
  return `/admin/users?${new URLSearchParams({ ...keep, ...extra })}#saved`;
}

function parse(formData: FormData) {
  const fail = (code: string): never => redirect(backTo(formData, { error: code }));
  const parsed = UserInput.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    role: formData.get("role"),
    secondary: String(formData.get("secondary") ?? ""),
    person: String(formData.get("person") ?? ""),
  });
  if (!parsed.success) return fail("invalid");
  const data = parsed.data;
  // The secondary role can't be the same as the primary role.
  if (data.secondary && data.secondary === data.role) fail("same");
  return { ...data, fail };
}

/**
 * The secondary role (optional). The first time, also makes sure the users tab has the "secondary_role"
 * heading; if that check fails (e.g. Google is busy) the role is still saved, as column E.
 */
let headerChecked = false;
async function secondaryFor(secondary: string) {
  if (!secondary) return "";
  if (!headerChecked) {
    try {
      await getStore().init();
      headerChecked = true;
    } catch (error) {
      console.error("Could not check the users tab headings:", error);
    }
  }
  return secondary as Role;
}

// The linked person is optional. If one is chosen, an IM login links to an IM, a Rig login to a rig team member.
async function linkedPerson(role: LoginRole, personId: string, fail: (code: string) => never) {
  const linked = checkUserLink(role, personId, await getStore().list("people"));
  return linked === undefined ? fail("person") : linked;
}

export async function addUser(formData: FormData) {
  await requireRole("admin");
  const { email, role, secondary, person, fail } = parse(formData);
  const store = getStore();
  if ((await store.list("users")).some((u) => u.email.toLowerCase() === email)) fail("exists");
  const person_id = await linkedPerson(role, person, fail);
  await store.upsert("users", [
    { email, role, person_id, active: "true", secondary_role: await secondaryFor(secondary) },
  ]);
  revalidatePath("/admin/users");
  redirect(backTo(formData, { saved: email }));
}

export async function saveUser(formData: FormData) {
  const me = await requireRole("admin");
  const { email, role, secondary, person, fail } = parse(formData);
  if (email === me.email?.toLowerCase()) fail("self"); // keeps at least one admin able to sign in
  const store = getStore();
  if (!(await store.list("users")).some((u) => u.email.toLowerCase() === email)) fail("invalid");
  const person_id = await linkedPerson(role, person, fail);
  await store.upsert("users", [
    {
      email,
      role,
      person_id,
      active: formData.get("active") === "on" ? "true" : "false",
      secondary_role: await secondaryFor(secondary),
    },
  ]);
  revalidatePath("/admin/users");
  redirect(backTo(formData, { saved: email }));
}
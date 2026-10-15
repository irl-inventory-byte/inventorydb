"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { checkUserLink, type LoginRole } from "@/lib/user-link";

const UserInput = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(["admin", "im", "rig", "fo", "hardware", "qc", "internal"]),
  person: z.string(),
});

const fail = (code: string): never => redirect(`/admin/users?error=${code}`);

function parse(formData: FormData) {
  const parsed = UserInput.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    role: formData.get("role"),
    person: String(formData.get("person") ?? ""),
  });
  return parsed.success ? parsed.data : fail("invalid");
}

// An IM login links to an IM in the People tab, a Rig login to a rig team member.
async function linkedPerson(role: LoginRole, personId: string) {
  const linked = checkUserLink(role, personId, await getStore().list("people"));
  return linked === undefined ? fail("person") : linked;
}

export async function addUser(formData: FormData) {
  await requireRole("admin");
  const { email, role, person } = parse(formData);
  const store = getStore();
  if ((await store.list("users")).some((u) => u.email.toLowerCase() === email)) fail("exists");
  await store.upsert("users", [{ email, role, person_id: await linkedPerson(role, person), active: "true" }]);
  revalidatePath("/admin/users");
}

export async function saveUser(formData: FormData) {
  const me = await requireRole("admin");
  const { email, role, person } = parse(formData);
  if (email === me.email?.toLowerCase()) fail("self"); // keeps at least one admin able to sign in
  const store = getStore();
  if (!(await store.list("users")).some((u) => u.email.toLowerCase() === email)) fail("invalid");
  await store.upsert("users", [
    {
      email,
      role,
      person_id: await linkedPerson(role, person),
      active: formData.get("active") === "on" ? "true" : "false",
    },
  ]);
  revalidatePath("/admin/users");
}
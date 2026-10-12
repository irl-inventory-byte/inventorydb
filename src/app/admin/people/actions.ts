"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";

// Email is required for both adding and editing.
const PersonInput = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.enum(["im", "ifo", "fo", "rig", "hardware", "qc"]),
  hub: z.string().trim().min(1),
  email: z.email("Enter a valid email address"),
});

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parsePerson(formData: FormData) {
  return PersonInput.safeParse({
    name: String(formData.get("name") ?? ""),
    role: String(formData.get("role") ?? ""),
    hub: String(formData.get("hub") ?? ""),
    email: normalizeEmail(
      String(formData.get("email") ?? "")
    ),
  });
}

function fail(
  error: "invalid" | "email_exists" | "person_not_found"
): never {
  redirect(
    `/admin/people?${new URLSearchParams({ error })}`
  );
}

function refreshPeoplePages() {
  revalidatePath("/admin/people");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/analytics");
  revalidatePath("/dashboard/my");
  revalidatePath("/inventory");
  revalidatePath("/handover/send");
  revalidatePath("/handover/receive");
}

/**
 * ADD PERSON
 * Admin and IM only.
 * Check email against all people, including inactive records.
 */
export async function addPerson(formData: FormData) {
  await requireRole("admin", "im");

  const parsed = parsePerson(formData);

  if (!parsed.success) {
    fail("invalid");
  }

  const input = parsed.data;
  const store = getStore();

  const [people, hubs] = await Promise.all([
    store.list("people"),
    store.list("hubs"),
  ]);

  const validHub = hubs.some(
    (hub) =>
      hub.hub_id === input.hub &&
      hub.active !== "false"
  );

  if (!validHub) {
    fail("invalid");
  }

  // Ignore letter case and surrounding spaces.
  const duplicateEmail = people.some(
    (person) =>
      normalizeEmail(person.linked_user ?? "") ===
      input.email
  );

  if (duplicateEmail) {
    fail("email_exists");
  }

  await store.upsert("people", [
    {
      person_id: `p-${randomUUID()}`,
      name: input.name,
      role: input.role,
      hub: input.hub,
      linked_user: input.email,
      active: "true",
    },
  ]);

  refreshPeoplePages();
  redirect("/admin/people?done=added");
}

/**
 * SAVE PERSON
 * Preserve person_id so existing history remains linked.
 * A person can retain their own email.
 */
export async function savePerson(formData: FormData) {
  await requireRole("admin", "im");

  const personId = String(
    formData.get("person_id") ?? ""
  ).trim();

  const parsed = parsePerson(formData);

  if (!personId || !parsed.success) {
    fail("invalid");
  }

  const input = parsed.data;
  const store = getStore();

  const [people, hubs] = await Promise.all([
    store.list("people"),
    store.list("hubs"),
  ]);

  const existing = people.find(
    (person) => person.person_id === personId
  );

  if (!existing) {
    fail("person_not_found");
  }

  // Existing inactive hub assignments may be retained.
  // New assignments must use an active hub.
  const validHub = hubs.some(
    (hub) =>
      hub.hub_id === input.hub &&
      (
        hub.active !== "false" ||
        existing.hub === input.hub
      )
  );

  if (!validHub) {
    fail("invalid");
  }

  const duplicateEmail = people.some(
    (person) =>
      person.person_id !== personId &&
      normalizeEmail(person.linked_user ?? "") ===
        input.email
  );

  if (duplicateEmail) {
    fail("email_exists");
  }

  await store.upsert("people", [
    {
      person_id: personId,
      name: input.name,
      role: input.role,
      hub: input.hub,
      linked_user: input.email,
      active:
        formData.get("active") === "on"
          ? "true"
          : "false",
    },
  ]);

  refreshPeoplePages();
  redirect("/admin/people?done=saved");
}
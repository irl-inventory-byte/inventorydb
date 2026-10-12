"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { actorOptions, allowedActors, defaultActor, resolveActor } from "@/lib/actors";
import { requireRole } from "@/lib/authz";
import { planReceive, planSend, type HandoverContext, type HandoverPlan } from "@/lib/handover";
import type { Item } from "@/lib/schema";
import { collectIds } from "@/lib/scan";
import { archiveReceipt } from "@/lib/receipt-archive";
import { HANDLER_ROLES, storeFor } from "@/lib/access";
import { istTimestamp } from "@/lib/time";

// The site's own address, used for the QR code link inside the archived PDF.
async function siteUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const go = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params)}`;

// Shared by both flows: collect the scanned cards, plan, save all-or-nothing, redirect with the result.
async function run(
  formData: FormData,
  path: string,
  build: (targets: Item[], ctx: HandoverContext) => HandoverPlan | Promise<HandoverPlan>,
  summary: (plan: HandoverPlan) => Record<string, string>,
  onSaved?: (plan: HandoverPlan) => void | Promise<void>,
) {  const user = await requireRole(...HANDLER_ROLES);
  const ids = collectIds(String(formData.get("scanned") ?? ""), formData.getAll("ids").map(String));
  if (!ids.length) redirect(go(path, { error: "Scan or tick at least one item." }));

  // Scoped: the rig team can't scan rigs, and nobody can scan a type they can't see.
  const store = storeFor(user.role);
  const [found, hubs, people, users] = await Promise.all([
    store.getItemsByIds(ids),
    store.list("hubs"),
    store.list("people"),
    store.list("users"),
  ]);

  // Who is recording the handover (Sent by / Received by). Only an admin may name someone else; anyone
  // else is always recorded as themselves, whatever the form says. The signed-in account is saved separately.
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const isAdmin = user.role === "admin";
  const actor = resolveActor(
    isAdmin ? String(formData.get("by") ?? "") || defaultActor(user) : defaultActor(user),
    allowedActors(user, actorOptions(people, users, (id) => hubName.get(id) ?? id)),
  );
  if (!actor) {
    redirect(
      go(path, {
        error: isAdmin
          ? "Choose an IM or admin for who is recording this handover."
          : "Your login is not linked to an active IM or rig team member. Ask an admin to link you on the Users screen.",
      }),
    );
  }

  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    const shown = missing.slice(0, 5).join(", ");
    redirect(go(path, { error: `Not found: ${shown}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}. Nothing was saved.` }));
  }

  // Two spellings of the same card (SD-1 and sd-1) count once, and the stored serial is what gets used.
  const targets = [...new Map(ids.map((id) => [found.get(id)!.item_id, found.get(id)!])).values()];

  const plan = await build(
    targets,
    {
      hubs,
      people,
      actorPersonId: actor,
      by: user.email ?? "unknown",
      now: istTimestamp(),
      newId: (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`,
    },
  );
  if (plan.errors.length) redirect(go(path, { error: `${plan.errors.join(" ")} Nothing was saved.` }));

  await store.commitBatch(plan.events, plan.items);
  if (onSaved) await onSaved(plan);
  redirect(go(path, { done: String(plan.items.length), ...summary(plan) }));
}

export async function sendCards(formData: FormData) {
  // The person (or a typed "Internal" name) and the location are both required; planSend refuses the
  // send if either is missing.
  const input = {
    fromHub: String(formData.get("fromHub") ?? ""),
    recipient: String(formData.get("recipient") ?? ""),
    internalName: String(formData.get("internalName") ?? ""),
    toHub: String(formData.get("hub") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
  await run(
    formData,
    "/handover/send",
    (targets, ctx) => planSend(targets, input, ctx),
    (plan): Record<string, string> => ({
      status: plan.items[0]?.status ?? "",
      person: plan.items[0]?.current_holder ?? "",
      hub: plan.items[0]?.current_hub ?? "",
      batch: plan.events[0]?.batch_id ?? "",
    }),
    async (plan) => {
      // Save the receipt PDF to Drive and log it in the "Receipts" tab.
      // This runs after the page has redirected, so the user never waits for it,
      // and a Drive/Sheets problem cannot undo the handover that was just saved.
      const batchId = plan.events[0]?.batch_id;
      if (!batchId) return;
      const base = await siteUrl();
      after(() => archiveReceipt(batchId, base));
    },
  );
}

export async function receiveCards(formData: FormData) {
  const hub = String(formData.get("hub") ?? "");
  const note = String(formData.get("note") ?? "");
  const expectedRaw = String(formData.get("expected") ?? "").trim();
  const expected = expectedRaw === "" ? undefined : Number(expectedRaw);
  if (expected !== undefined && (!Number.isInteger(expected) || expected < 0)) {
    redirect(go("/handover/receive", { error: "Expected count must be a whole number." }));
  }
  await run(
    formData,
    "/handover/receive",
    (targets, ctx) => planReceive(targets, { hub, note, expected }, ctx),
    (plan): Record<string, string> => (plan.mismatch ? { mismatch: plan.mismatch } : {}),
  );
}
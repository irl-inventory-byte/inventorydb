"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { actorOptions, allowedActors, defaultActor, displayName, resolveActor } from "@/lib/actors";
import { requireRole } from "@/lib/authz";
import {
  planHardwareOutcome,
  planReceive,
  planReceiveHeld,
  planSend,
  receivesHeld,
  type HandoverContext,
  type HandoverPlan,
} from "@/lib/handover";
import type { Item, Role, TabRows } from "@/lib/schema";
import { collectIds } from "@/lib/scan";
import { archiveReceipt } from "@/lib/receipt-archive";
import { HANDLER_ROLES, RECEIVE_ROLES, SEND_ROLES, storeFor } from "@/lib/access";
import { getStore } from "@/lib/store";
import { peopleActingAs } from "@/lib/roles";
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
  // Who may use this flow, and which people can be named as Sent by / Received by.
  access: { roles: Role[]; actorRoles: Role[] } = { roles: HANDLER_ROLES, actorRoles: ["im", "rig", "internal"] },
) {
  const user = await requireRole(...access.roles);
  // Scoped: the rig team can't scan rigs, and nobody can scan a type they can't see.
  const store = storeFor(user.role);

  // A whole scanned line that is a known code stays one code, even with spaces in it (a mobile's Asset Tag,
  // e.g. "Android Phone - 0221"). Every other line is split into codes as before.
  const lines = String(formData.get("scanned") ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const wholeLines = await store.getItemsByIds(lines);
  const ids = [
    ...new Set([
      ...lines.filter((l) => wholeLines.has(l)),
      ...collectIds(lines.filter((l) => !wholeLines.has(l)).join("\n"), formData.getAll("ids").map(String)),
    ]),
  ];
  if (!ids.length) redirect(go(path, { error: "Scan or tick at least one item." }));

  const [found, hubs, sheetPeople, users] = await Promise.all([
    store.getItemsByIds(ids),
    store.list("hubs"),
    store.list("people"),
    store.list("users"),
  ]);

  // Primary / secondary role: the signed-in person acts in the role they switched to, and the person it is
  // sent to counts in the category it was chosen under (e.g. an IM who is also QC, chosen under "QC team").
  const people = peopleActingAs(sheetPeople, users, {
    actor: defaultActor(user),
    actorRole: user.role,
    recipient: String(formData.get("recipient") ?? ""),
    recipientRole: String(formData.get("recipientRole") ?? ""),
  });

  // Who is recording the handover (Sent by / Received by). Only an admin may name someone else; anyone
  // else is always recorded as themselves, whatever the form says. The signed-in account is saved separately.
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const isAdmin = user.role === "admin";
  const actor = resolveActor(
    isAdmin ? String(formData.get("by") ?? "") || defaultActor(user) : defaultActor(user),
    allowedActors(user, actorOptions(people, users, (id) => hubName.get(id) ?? id, access.actorRoles)),
  );
  if (!actor) {
    redirect(
      go(path, {
        error: isAdmin
          ? "Choose an IM or admin for who is recording this handover."
          : "Your login is not linked to an active person in People. Ask an admin to link you on the Users screen.",
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

  // The sender's role decides the rig rules (an admin's email has no person row).
  const senderRole: Role | "admin" = people.find((p) => p.person_id === actor)?.role ?? "admin";

  const plan = await build(
    targets,
    {
      hubs,
      people,
      senderRole,
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
  // Hardware team: R&D or Dead instead of sending a repaired rig to an IM.
  const hwOutcome = String(formData.get("hwOutcome") ?? "");
  if (hwOutcome === "rnd" || hwOutcome === "dead") return markHardwareOutcome(formData, hwOutcome);

  // The person (or a typed "Internal" name) and the location are both required; planSend refuses the
  // send if either is missing.
  const input = {
    fromHub: String(formData.get("fromHub") ?? ""),
    recipient: String(formData.get("recipient") ?? ""),
    internalName: String(formData.get("internalName") ?? ""),
    toHub: String(formData.get("hub") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
  // QC team: the QC result chosen on the Send page, saved for every rig in the send.
  const qcResult = String(formData.get("qcResult") ?? "");
  const qcComment = String(formData.get("qcComment") ?? "").trim().slice(0, 1000);
  let qcRows: TabRows["qc_checks"][] = [];
  // Hardware team → IM (Repaired): was the rig sanitized? Yes / No, saved on the receipt and the rig's history.
  // Chosen per rig ({"IC-6":"yes","IC-7":"no"}); an older page sends one answer for all rigs.
  const sanitized = String(formData.get("sanitized") ?? "");
  const allText = sanitized === "yes" ? "Yes" : sanitized === "no" ? "No" : "";
  const sanitizedMap = new Map<string, string>();
  try {
    const raw: unknown = JSON.parse(String(formData.get("sanitizedMap") ?? "") || "{}");
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) if (v === "yes" || v === "no") sanitizedMap.set(k.trim().toUpperCase(), v === "yes" ? "Yes" : "No");
    }
  } catch {
    // ignore a broken value; the check below asks for the answers again
  }
  const sanitizedOf = (id: string) => sanitizedMap.get(id.trim().toUpperCase()) ?? allText;
  let hwRows: TabRows["hardware_updates"][] = [];

  await run(
    formData,
    "/handover/send",
    async (targets, ctx) => {
      // Latest QC result per rig (rows are oldest first, so the last one wins).
      const qcStatus = new Map<string, string>();
      if (targets.some((t) => t.item_type === "rig")) {
        for (const c of await getStore().list("qc_checks")) qcStatus.set(c.item_id, c.qc_status);
      }

      if (ctx.senderRole === "qc" && qcResult === "transfer") {
        // QC → QC transfer: no result is saved; the other QC person receives the rig and checks it.
        const to = ctx.people.find((p) => p.person_id === input.recipient);
        if (!to || to.role !== "qc") {
          return { events: [], items: [], errors: ["A transfer goes to another QC person. Choose one from the QC team."] };
        }
        if (to.person_id === ctx.actorPersonId) {
          return { events: [], items: [], errors: ["Choose another QC person, not yourself."] };
        }
      } else if (ctx.senderRole === "qc") {
        if (qcResult !== "pass" && qcResult !== "fail") {
          return { events: [], items: [], errors: ["Choose the QC result: Pass, Fail or Transfer."] };
        }
        if (ctx.people.find((p) => p.person_id === input.recipient)?.role === "qc") {
          return { events: [], items: [], errors: ["To send to another QC person, choose Transfer."] };
        }
        if (qcResult === "fail" && !qcComment) {
          return { events: [], items: [], errors: ["Write what failed."] };
        }
        // The result applies to every rig in this send (Pass → IM, Fail → hardware team).
        for (const t of targets) qcStatus.set(t.item_id, qcResult);
        qcRows = targets.map((t) => ({
          check_id: ctx.newId("qc"),
          item_id: t.item_id,
          recorded_at: ctx.now,
          recorded_by: ctx.by,
          recorded_by_name: displayName(ctx.people, ctx.actorPersonId),
          qc_status: qcResult,
          comment: qcComment,
        }));
      } else {
        // Hardware team: "Repaired" goes to an IM, "Send to hardware" to ANOTHER hardware person.
        if (ctx.senderRole === "hardware") {
          const to = ctx.people.find((p) => p.person_id === input.recipient);
          if (hwOutcome === "transfer") {
            if (!to || to.role !== "hardware") {
              return { events: [], items: [], errors: ["\"Send to hardware\" goes to another hardware person. Choose one from the Hardware team."] };
            }
            if (to.person_id === ctx.actorPersonId) {
              return { events: [], items: [], errors: ["Choose another hardware person, not yourself."] };
            }
          } else if (hwOutcome === "repaired" && to && to.role !== "im") {
            return { events: [], items: [], errors: ["A repaired rig goes to an IM. To hand it to another hardware person, choose \"Send to hardware\"."] };
          } else if (hwOutcome === "repaired" && targets.some((t) => t.item_type === "rig" && !sanitizedOf(t.item_id))) {
            const left = targets.filter((t) => t.item_type === "rig" && !sanitizedOf(t.item_id)).map((t) => t.item_id);
            return { events: [], items: [], errors: [`Choose the Sanitization status (Yes or No) for: ${left.join(", ")}.`] };
          } else if (!hwOutcome) {
            return { events: [], items: [], errors: ["Choose the rig status."] };
          }
        }
        // IM → QC team: the rig's QC goes back to "QC pending" until QC records Pass or Fail.
        // Hardware team → IM: the rig is "Repaired · Ready for field".
        const toRole = ctx.people.find((p) => p.person_id === input.recipient)?.role;
        const mark =
          toRole === "qc" && ctx.senderRole !== "hardware"
            ? { status: "qc_pending" as const, comment: "Sent to QC for checking" }
            : ctx.senderRole === "hardware" && toRole === "im"
              ? { status: "repaired" as const, comment: "Repaired by hardware team" }
              : undefined;
        if (ctx.senderRole === "hardware" && toRole === "im") {
          // On the receipt (the send note) and in each rig's hardware updates.
          const rigsSent = targets.filter((t) => t.item_type === "rig" && sanitizedOf(t.item_id));
          const answers = new Set(rigsSent.map((t) => sanitizedOf(t.item_id)));
          const summary =
            answers.size === 1
              ? `Sanitization: ${[...answers][0]}`
              : `Sanitization: ${rigsSent.map((t) => `${t.item_id} ${sanitizedOf(t.item_id)}`).join(", ")}`;
          if (rigsSent.length) input.note = [summary, input.note.trim()].filter(Boolean).join(" · ");
          hwRows = rigsSent
            .map((t) => ({
              update_id: ctx.newId("hw"),
              item_id: t.item_id,
              recorded_at: ctx.now,
              recorded_by: ctx.by,
              recorded_by_name: displayName(ctx.people, ctx.actorPersonId),
              update_type: "Sanitization",
              comment: sanitizedOf(t.item_id),
            }));
        }
        // IM → FO / IFO / internal with a rig the hardware team repaired: it goes out as "QC passed".
        if (!mark && ctx.senderRole !== "hardware" && (toRole === "fo" || toRole === "ifo" || toRole === "internal" || (!toRole && input.internalName.trim()))) {
          qcRows = targets
            .filter((t) => t.item_type === "rig" && qcStatus.get(t.item_id) === "repaired")
            .map((t) => ({
              check_id: ctx.newId("qc"),
              item_id: t.item_id,
              recorded_at: ctx.now,
              recorded_by: ctx.by,
              recorded_by_name: displayName(ctx.people, ctx.actorPersonId),
              qc_status: "pass" as const,
              comment: "Repaired by hardware · QC passed when sent to the field",
            }));
        }
        if (mark) {
          qcRows = targets
            .filter((t) => t.item_type === "rig")
            .map((t) => ({
              check_id: ctx.newId("qc"),
              item_id: t.item_id,
              recorded_at: ctx.now,
              recorded_by: ctx.by,
              recorded_by_name: displayName(ctx.people, ctx.actorPersonId),
              qc_status: mark.status,
              comment:
                mark.status === "repaired" && sanitizedOf(t.item_id)
                  ? `${mark.comment} · Sanitization: ${sanitizedOf(t.item_id)}`
                  : mark.comment,
            }));
        }
      }

      return planSend(targets, input, { ...ctx, qcStatus });
    },
    (plan): Record<string, string> => ({
      status: plan.items[0]?.status ?? "",
      person: plan.items[0]?.current_holder ?? "",
      hub: plan.items[0]?.current_hub ?? "",
      batch: plan.events[0]?.batch_id ?? "",
    }),
    async (plan) => {
      // Save the rig QC change (QC result, back to QC pending, or repaired) with the handover.
      if (qcRows.length) await getStore().appendRows("qc_checks", qcRows);
      if (hwRows.length) await getStore().appendRows("hardware_updates", hwRows);

      // Save the receipt PDF to Drive and log it in the "Receipts" tab.
      // This runs after the page has redirected, so the user never waits for it,
      // and a Drive/Sheets problem cannot undo the handover that was just saved.
      const batchId = plan.events[0]?.batch_id;
      if (!batchId) return;
      const base = await siteUrl();
      after(() => archiveReceipt(batchId, base));
    },
    { roles: SEND_ROLES, actorRoles: ["im", "rig", "qc", "hardware", "internal"] },
  );
}

/** Hardware team marks the rigs they hold as R&D or Dead (from the Send page). No receipt: nothing changes hands. */
async function markHardwareOutcome(formData: FormData, outcome: "rnd" | "dead") {
  const reason = String(formData.get("hwReason") ?? "").trim().slice(0, 1000);
  let updates: TabRows["hardware_updates"][] = [];
  await run(
    formData,
    "/handover/send",
    (targets, ctx) => {
      const plan = planHardwareOutcome(targets, { outcome, reason }, ctx);
      updates = plan.items.map((t) => ({
        update_id: ctx.newId("hw"),
        item_id: t.item_id,
        recorded_at: ctx.now,
        recorded_by: ctx.by,
        recorded_by_name: displayName(ctx.people, ctx.actorPersonId),
        update_type: outcome === "dead" ? "Declared dead" : "Moved to R&D",
        comment: reason,
      }));
      return plan;
    },
    (): Record<string, string> => ({ outcome }),
    async () => {
      if (updates.length) await getStore().appendRows("hardware_updates", updates);
    },
    { roles: SEND_ROLES, actorRoles: ["im", "rig", "qc", "hardware", "internal"] },
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
    // QC / hardware team: receive the rigs sent to them. Everyone else: take items into stock at a hub.
    (targets, ctx) =>
      receivesHeld(ctx.senderRole)
        ? planReceiveHeld(targets, { note }, ctx)
        : planReceive(targets, { hub, note, expected }, ctx),
    (plan): Record<string, string> => (plan.mismatch ? { mismatch: plan.mismatch } : {}),
    undefined,
    { roles: RECEIVE_ROLES, actorRoles: ["im", "rig", "qc", "hardware", "internal"] },
  );
}
"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { IC_TRANSFER_ROLES } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { planCorrection } from "@/lib/correction";
import { planSend, type HandoverPlan } from "@/lib/handover";
import { archiveReceipt } from "@/lib/receipt-archive";
import { rigHomeHub } from "@/lib/rig-hub";
import { getStore } from "@/lib/store";
import { collectIds } from "@/lib/scan";
import { istTimestamp } from "@/lib/time";
import { run, siteUrl } from "../handover/actions";

const go = (params: Record<string, string>) => `/ic/transfer?${new URLSearchParams(params)}`;

/**
 * IC → FO transfer. A trimmed-down version of the general Send items flow (lib/handover.ts's planSend
 * does the actual work, same as every other send): always from Bangalore stock, always recorded at
 * Bangalore, the recipient must be an FO, and a note is required. On save, the receipt is archived and —
 * because the recipient is an FO — automatically emailed to them (see lib/receipt-archive.ts's
 * toCanEmail), with the item list attached as the receipt PDF.
 */
export async function transferToFo(formData: FormData) {
  const note = String(formData.get("note") ?? "").trim();
  if (!note) redirect(go({ error: "Notes are required." }));

  await run(
    formData,
    "/ic/transfer",
    (targets, ctx): HandoverPlan => {
      const bangalore = rigHomeHub(ctx.hubs);
      if (!bangalore) {
        return { events: [], items: [], errors: ["No Bangalore hub found. Ask an admin to add one in Manage hubs."] };
      }
      const recipientId = String(formData.get("recipient") ?? "");
      const recipient = ctx.people.find((p) => p.person_id === recipientId && p.active !== "false");
      if (!recipient || recipient.role !== "fo") {
        return { events: [], items: [], errors: ["Choose the field officer (FO) you are sending to."] };
      }
      return planSend(
        targets,
        { fromHub: bangalore.hub_id, recipient: recipient.person_id, toHub: bangalore.hub_id, note },
        ctx,
      );
    },
    (plan): Record<string, string> => ({
      person: plan.items[0]?.current_holder ?? "",
      batch: plan.events[0]?.batch_id ?? "",
    }),
    async (plan) => {
      const batchId = plan.events[0]?.batch_id;
      if (!batchId) return;
      const base = await siteUrl();
      // Archiving + emailing the receipt to the receiving FO runs after the page has redirected, same as
      // every other handover — the IC never waits on it, and a Drive/email hiccup can't undo the transfer.
      after(() => archiveReceipt(batchId, base));
    },
    { roles: IC_TRANSFER_ROLES, actorRoles: ["ic"] },
  );
}

/**
 * FO → FO transfer. Separate from transferToFo above, which only moves Bangalore stock OUT to an FO
 * for the first time. This one moves an item that is ALREADY with one FO straight to a different FO —
 * planSend can't be reused here: it only accepts items currently "in_stock" at the chosen hub (see
 * lib/handover.ts), and an item "with_fo" never is. Built on planCorrection instead — the same direct-
 * reassignment primitive the admin Corrections screen uses on /inventory — which writes one "correct"
 * event straight to the new FO, immediately, with no pending/receive step on either side (the decision
 * when this was built: a plain transfer, not a send-then-receive flow). A receipt is still emailed —
 * to both FOs (the one giving the item up and the one receiving it — see lib/receipt-archive.ts, which
 * now also emails the "from" party on a "correct" action, not just a "receive") and, as an explicit
 * extra recipient, to whoever (IC or admin) recorded this transfer.
 */
export async function transferFoToFo(formData: FormData) {
  const user = await requireRole(...IC_TRANSFER_ROLES);
  const store = getStore();

  const lines = String(formData.get("scanned") ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const wholeLines = await store.getItemsByIds(lines);
  const ids = [
    ...new Set([
      ...lines.filter((l) => wholeLines.has(l)),
      ...collectIds(lines.filter((l) => !wholeLines.has(l)).join("\n")),
    ]),
  ];
  if (!ids.length) redirect(go({ ferror: "Type or scan at least one item." }));

  const [found, hubs, people] = await Promise.all([
    store.getItemsByIds(ids),
    store.list("hubs"),
    store.list("people"),
  ]);

  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    const shown = missing.slice(0, 5).join(", ");
    redirect(
      go({ ferror: `Not found: ${shown}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}. Nothing was saved.` }),
    );
  }

  const targets = [...new Map(ids.map((id) => [found.get(id)!.item_id, found.get(id)!])).values()];

  const notWithFo = targets.filter((t) => t.status !== "with_fo").map((t) => `${t.item_id} (${t.status})`);
  if (notWithFo.length) {
    redirect(
      go({
        ferror: `Only items currently with an FO can be moved this way. Not with an FO: ${notWithFo.slice(0, 5).join(", ")}${notWithFo.length > 5 ? ` and ${notWithFo.length - 5} more` : ""}. Nothing was saved.`,
      }),
    );
  }

  const recipientId = String(formData.get("recipient") ?? "");
  const recipient = people.find((p) => p.person_id === recipientId && p.active !== "false");
  if (!recipient || recipient.role !== "fo") {
    redirect(go({ ferror: "Choose the field officer (FO) you are moving these items to." }));
  }

  const note = String(formData.get("note") ?? "").trim();
  if (!note) redirect(go({ ferror: "Notes are required." }));

  const plan = planCorrection(
    targets,
    { status: "with_fo", hub: recipient.hub, holder: recipient.person_id, homeHub: "", note },
    {
      hubs,
      people,
      by: user.email ?? "unknown",
      now: istTimestamp(),
      newId: (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`,
    },
  );
  if (plan.errors.length) redirect(go({ ferror: `${plan.errors.join(" ")} Nothing was saved.` }));

  if (plan.items.length) {
    await store.commitBatch(plan.events, plan.items);
    revalidatePath("/inventory");
    revalidatePath("/inventory/[id]", "page");
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/analytics");
    revalidatePath("/dashboard/my");

    const batchId = plan.events[0]?.batch_id;
    if (batchId) {
      const base = await siteUrl();
      // Same "don't make them wait on archiving" trade-off as transferToFo above: runs after the page
      // has already redirected.
      after(() =>
        archiveReceipt(batchId, base, {
          extraRecipients: [{ id: user.personId || user.email || "", name: user.name || user.email || "IC" }],
        }),
      );
    }
  }

  redirect(go({ fdone: String(plan.items.length), fsame: String(plan.unchanged.length), fperson: recipient.name }));
}
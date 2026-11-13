"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { IC_TRANSFER_ROLES } from "@/lib/access";
import { planSend, type HandoverPlan } from "@/lib/handover";
import { archiveReceipt } from "@/lib/receipt-archive";
import { rigHomeHub } from "@/lib/rig-hub";
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
import { randomUUID } from "node:crypto";
import { getStore } from "./store";
import type { Acknowledgment } from "./schema";
import { istTimestamp } from "./time";

/**
 * Acknowledgment of a handover receipt: the person now holding the items confirms, with one click
 * in the receipt email, that they received everything in good condition. See lib/receipt-email.ts
 * (the email) and app/handover/ack/[token] (the page the links open).
 *
 * IMPORTANT: Acknowledgment rows are mutated after creation (Yes/No is filled in later), unlike
 * every other append-only tab in this app. Supabase's upsert fills every column of the tab with
 * blank for any key not in the row you pass it (see store/supabase.ts `clean()`), so an update here
 * always starts from the full existing row — never a partial patch — or it will wipe the rest of
 * that row back to blank.
 */

export async function createAcknowledgment(input: {
  batchId: string;
  action: string;
  toId: string;
  toPerson: string;
  fromId: string;
  fromPerson: string;
  itemCount: number;
}): Promise<Acknowledgment> {
  const row: Acknowledgment = {
    ack_id: `ack-${randomUUID().slice(0, 8)}`,
    batch_id: input.batchId,
    action: input.action,
    token: randomUUID(),
    to_id: input.toId,
    to_person: input.toPerson,
    from_id: input.fromId,
    from_person: input.fromPerson,
    item_count: String(input.itemCount),
    created_at: istTimestamp(),
    answer: "",
    answered_at: "",
  };
  await getStore().appendRows("acknowledgments", [row]);
  return row;
}

export async function findAcknowledgment(token: string): Promise<Acknowledgment | undefined> {
  if (!token) return undefined;
  const rows = await getStore().list("acknowledgments");
  return rows.find((r) => r.token === token);
}

/**
 * Record Yes/No for a token. Idempotent: if it was already answered, the first answer stands and
 * is returned unchanged (so clicking an old email link twice, or a slow double-tap, can't flip it).
 */
export async function recordAcknowledgmentAnswer(
  token: string,
  answer: "yes" | "no",
): Promise<Acknowledgment | undefined> {
  const existing = await findAcknowledgment(token);
  if (!existing) return undefined;
  if (existing.answer) return existing; // already answered — leave it alone

  const updated: Acknowledgment = { ...existing, answer, answered_at: istTimestamp() };
  await getStore().upsert("acknowledgments", [updated]); // full row — see note above
  return updated;
}

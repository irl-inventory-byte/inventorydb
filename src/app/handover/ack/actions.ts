"use server";

import { redirect } from "next/navigation";
import { recordAcknowledgmentAnswer } from "@/lib/acknowledgment";

/**
 * Public — no login. The token in the link IS the credential (like an unsubscribe link), so this
 * takes no role check. The actual Yes/No click happens here (not on the GET link itself) so an email
 * client or security scanner prefetching the link's URL can't accidentally record an answer.
 */
export async function confirmAcknowledgment(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const answer = String(formData.get("answer") ?? "");

  if (!token || (answer !== "yes" && answer !== "no")) {
    redirect(`/handover/ack/${encodeURIComponent(token)}?error=1`);
  }

  await recordAcknowledgmentAnswer(token, answer);
  redirect(`/handover/ack/${encodeURIComponent(token)}`);
}

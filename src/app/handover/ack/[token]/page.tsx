import { findAcknowledgment, recordAcknowledgmentAnswer } from "@/lib/acknowledgment";
import { formatIst } from "@/lib/time";
import styles from "../../../admin/admin.module.css";

/**
 * Public page opened by the single "Yes, I acknowledge" link in a receipt email. No login — the
 * token in the URL is the credential, exactly like an unsubscribe link. Visiting this page IS the
 * acknowledgment: there's no second "Confirm" step and nothing else to click, so it's recorded the
 * moment the page loads, not on a separate action. (Trade-off: an email client or security scanner
 * that opens links automatically before a person does could record a false acknowledgment — accepted
 * here in exchange for a true one-click flow with no extra page in the way.)
 */
export default async function AcknowledgePage({ params }: PageProps<"/handover/ack/[token]">) {
  const { token } = await params;

  const existing = await findAcknowledgment(token);
  if (!existing) {
    return (
      <main className={styles.page}>
        <h1>Link not found</h1>
        <p className={styles.muted}>
          This acknowledgment link is invalid, or the batch it belongs to could not be found. If you
          think this is a mistake, contact the person who sent you the receipt email.
        </p>
      </main>
    );
  }

  // Idempotent: if this link was already opened, this just shows the same result again.
  const ack = existing.answer ? existing : (await recordAcknowledgmentAnswer(token, "yes")) ?? existing;

  return (
    <main className={styles.page}>
      <h1>Acknowledged</h1>
      <p>
        Thanks — batch {ack.batch_id} ({ack.item_count} item{ack.item_count === "1" ? "" : "s"}) is
        recorded as acknowledged, at {formatIst(ack.answered_at)} IST.
      </p>
      <p className={styles.muted}>No further action is needed.</p>
    </main>
  );
}

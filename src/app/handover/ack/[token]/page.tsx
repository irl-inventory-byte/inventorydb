import { findAcknowledgment } from "@/lib/acknowledgment";
import { acknowledgmentText } from "@/lib/acknowledgment-text";
import { formatIst } from "@/lib/time";
import { one } from "@/lib/labels";
import { confirmAcknowledgment } from "../actions";
import styles from "../../../admin/admin.module.css";

/**
 * Public page opened from the Yes/No links in a receipt email. No login — the token in the URL is
 * the credential, exactly like an unsubscribe link. Clicking Yes or No here lands on this same page
 * with ?a= set, which just pre-selects the matching button; the actual answer is only recorded when
 * they press Confirm (a real form submit), so an email client or scanner prefetching the links in the
 * email itself can never record a false answer.
 */
export default async function AcknowledgePage({
  params,
  searchParams,
}: PageProps<"/handover/ack/[token]">) {
  const { token } = await params;
  const sp = await searchParams;
  const preselect = one(sp.a) === "no" ? "no" : "yes";

  const ack = await findAcknowledgment(token);

  if (!ack) {
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

  if (ack.answer) {
    return (
      <main className={styles.page}>
        <h1>Already recorded</h1>
        <p>
          You already answered <strong>{ack.answer === "yes" ? "Yes" : "No"}</strong> for batch{" "}
          {ack.batch_id}, at {formatIst(ack.answered_at)} IST. No further action is needed.
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page} style={{ maxWidth: 560 }}>
      <h1>Acknowledge receipt</h1>
      <p className={styles.muted}>
        Batch {ack.batch_id} · {ack.item_count} item{ack.item_count === "1" ? "" : "s"}
      </p>

      <div
        style={{
          margin: "16px 0",
          padding: "14px 16px",
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 8,
        }}
      >
        <p style={{ margin: 0 }}>{acknowledgmentText(ack.from_person)}</p>
      </div>

      <form action={confirmAcknowledgment} className={styles.row}>
        <input type="hidden" name="token" value={token} />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="radio" name="answer" value="yes" defaultChecked={preselect === "yes"} required />
          Yes, I received everything in satisfactory condition
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="radio" name="answer" value="no" defaultChecked={preselect === "no"} required />
          No, something&apos;s wrong
        </label>
        <button type="submit">Confirm</button>
      </form>
    </main>
  );
}

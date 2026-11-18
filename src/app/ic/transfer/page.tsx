import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { IC_TRANSFER_ROLES, handoverStoreFor } from "@/lib/access";
import styles from "../../handover/form.module.css";
import { transferFoToFo } from "../actions";
import BackLink from "../../BackLink";
import FoToFoFields from "./FoToFoFields";

// The original "Transfer to FO" (Bangalore stock → FO) flow — transferToFo in ../actions, the
// IcTransferFields component — is still in the codebase, just not rendered here any more: this page
// now only offers "Transfer between FOs". Removed, not deleted, in case it's wanted back later.
export default async function IcTransferPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(...IC_TRANSFER_ROLES);
  const sp = await searchParams;
  const store = handoverStoreFor(user.role);
  const [people, hubs] = await Promise.all([store.list("people"), store.list("hubs")]);

  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const fos = people
    .filter((p) => p.role === "fo" && p.active !== "false")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.person_id, name: p.name, city: hubName.get(p.hub) ?? p.hub }));

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <BackLink />
      </p>
      <h1>Transfer between FOs</h1>
      <p className={styles.hint}>
        Move an item that&apos;s already with one FO straight to a different FO. This happens
        immediately; the receiving FO doesn&apos;t need to confirm anything. A receipt is emailed to
        both FOs and to whoever records the transfer.
      </p>

      <form action={transferFoToFo} className={styles.form}>
        <FoToFoFields fos={fos} />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="fonote">
            Notes *
          </label>
          <div className={styles.control}>
            <textarea id="fonote" name="note" rows={3} className={styles.textarea} required />
            <p className={styles.hint}>Required — say what this transfer is for.</p>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit">Transfer</button>
        </div>

        {one(sp.fdone) && (
          <p className={`${styles.ok} ${styles.result}`}>
            Moved {one(sp.fdone)} item(s) to {one(sp.fperson)}.
          </p>
        )}
        {one(sp.ferror) && <p className={`${styles.error} ${styles.result}`}>{one(sp.ferror)}</p>}
      </form>
    </main>
  );
}
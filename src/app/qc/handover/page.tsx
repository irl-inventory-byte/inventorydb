import { requireRole } from "@/lib/authz";
import { handoverStoreFor } from "@/lib/access";
import { one } from "@/lib/labels";
import { formatIst } from "@/lib/time";
import styles from "../../handover/form.module.css";
import { handoverToHardware } from "../../handover/actions";
import BackLink from "../../BackLink";
import HandoverToHardwareFields from "./HandoverToHardwareFields";

/**
 * QC team only: the second, separate step for a QC-failed rig — actually handing it to the hardware
 * team. Recording "Fail" on the Send page (/handover/send) never does this by itself anymore; this
 * page is the only place that does. Reached from the dashboard's "QC fail" tile and from Rig checks.
 */
export default async function QcHandoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("qc");
  const sp = await searchParams;
  const store = handoverStoreFor(user.role);
  const [people, items, qcChecks] = await Promise.all([
    store.list("people"),
    store.list("items"),
    store.list("qc_checks"),
  ]);

  // Latest QC result per rig (rows are oldest first, so the last one wins).
  const latestQc = new Map<string, { status: string; comment: string; recorded_at: string }>();
  for (const c of qcChecks) latestQc.set(c.item_id, { status: c.qc_status, comment: c.comment, recorded_at: c.recorded_at });

  // Only rigs that are QC-failed AND still with this QC person (not yet handed over to hardware).
  const failedRigs = items
    .filter((i) => i.item_type === "rig" && i.status === "with_qc" && i.current_holder === user.personId)
    .filter((i) => latestQc.get(i.item_id)?.status === "fail")
    .map((i) => {
      const qc = latestQc.get(i.item_id);
      return {
        id: i.item_id,
        label: [i.brand, i.model].filter(Boolean).join(" ") || i.item_id,
        comment: qc?.comment ?? "",
        since: formatIst(qc?.recorded_at ?? i.updated_at),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const hardwarePeople = people
    .filter((p) => p.role === "hardware" && p.active !== "false")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.person_id, name: p.name }));

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <BackLink />
      </p>
      <h1>Handover to hardware</h1>
      <p className={styles.hint}>
        Moves QC-failed rigs to the hardware team. This is the only action that actually sends a failed
        rig anywhere — marking a rig Fail on the Send page never does this by itself.
      </p>

      <form action={handoverToHardware} className={styles.form}>
        <HandoverToHardwareFields rigs={failedRigs} hardwarePeople={hardwarePeople} />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="note">
            Notes
          </label>
          <div className={styles.control}>
            <textarea id="note" name="note" rows={3} className={styles.textarea} />
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit">Handover to hardware</button>
        </div>

        {one(sp.done) && (
          <p className={`${styles.ok} ${styles.result}`}>Handed over {one(sp.done)} rig(s) to the hardware team.</p>
        )}
        {one(sp.error) && <p className={`${styles.error} ${styles.result}`}>{one(sp.error)}</p>}
      </form>
    </main>
  );
}
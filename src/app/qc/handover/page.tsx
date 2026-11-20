import { requireRole } from "@/lib/authz";
import { handoverStoreFor } from "@/lib/access";
import { one } from "@/lib/labels";
import { formatIst } from "@/lib/time";
import styles from "../../handover/form.module.css";
import { handoverToHardware } from "../../handover/actions";
import BackLink from "../../BackLink";
import QcPersonPicker from "./QcPersonPicker";
import HandoverToHardwareFields from "./HandoverToHardwareFields";

/**
 * "QC Fail to Hardware" — the only action that actually sends a QC-failed rig to the hardware team.
 * Recording Fail on the Send page (/handover/send) never does this by itself anymore. Visible as its
 * own home tile for "admin" and "qc" only (see roles on the WORK tile in app/page.tsx).
 */
export default async function QcHandoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("qc", "admin");
  const sp = await searchParams;
  const store = handoverStoreFor(user.role);
  const [people, items, qcChecks] = await Promise.all([
    store.list("people"),
    store.list("items"),
    store.list("qc_checks"),
  ]);

  const qcPeople = people
    .filter((p) => p.role === "qc" && p.active !== "false")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.person_id, name: p.name }));

  // Which QC person's rigs to show: an admin picks from a dropdown (acting on their behalf); a QC
  // person always sees their own — same "act on behalf of" rule as Send items.
  const selectedId = user.role === "admin" ? one(sp.person) || qcPeople[0]?.id || "" : user.personId;
  const selectedName = people.find((p) => p.person_id === selectedId)?.name ?? "";

  // Latest QC result per rig (rows are oldest first, so the last one wins).
  const latestQc = new Map<string, { status: string; comment: string; recorded_at: string }>();
  for (const c of qcChecks) latestQc.set(c.item_id, { status: c.qc_status, comment: c.comment, recorded_at: c.recorded_at });

  // Only rigs that are QC-failed AND still with the selected QC person (not yet handed over).
  const failedRigs = items
    .filter((i) => i.item_type === "rig" && i.status === "with_qc" && i.current_holder === selectedId)
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
      <h1>QC Fail to Hardware</h1>
      <p className={styles.hint}>
        Hands QC-failed rigs over to the hardware team. This is the only action that actually sends a
        failed rig anywhere — marking a rig Fail on the Send page never does this by itself.
      </p>

      <div className={styles.field}>
        <label className={styles.label}>QC person</label>
        <div className={styles.control}>
          {user.role === "admin" ? (
            <>
              <QcPersonPicker qcPeople={qcPeople} defaultId={selectedId} />
              <p className={styles.hint}>As an admin you can hand over on behalf of any QC person.</p>
            </>
          ) : qcPeople.length ? (
            <>
              <strong>{selectedName}</strong>
              <p className={styles.hint}>Handovers are recorded under your name.</p>
            </>
          ) : (
            <p className={styles.error}>
              Your login is not linked to an active person in People, so you can&apos;t do this yet. Ask an admin
              to link you on the Users screen.
            </p>
          )}
        </div>
      </div>

      <form action={handoverToHardware} className={styles.form}>
        {user.role === "admin" && <input type="hidden" name="by" value={selectedId} />}

        <div className={styles.field}>
          <label className={styles.label}>QC result</label>
          <div className={styles.control}>
            <p style={{ margin: 0, fontWeight: 700, color: "#ef4444" }}>Fail</p>
            <p className={styles.hint}>Only rigs already recorded as Fail show up below — see Send items.</p>
          </div>
        </div>

        <HandoverToHardwareFields rigs={failedRigs} hardwarePeople={hardwarePeople} />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="note">
            Notes *
          </label>
          <div className={styles.control}>
            <textarea id="note" name="note" rows={3} className={styles.textarea} required />
            <p className={styles.hint}>Required — say what this handover is for.</p>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit">Send to hardware</button>
        </div>

        {one(sp.done) && (
          <p className={`${styles.ok} ${styles.result}`}>Handed over {one(sp.done)} rig(s) to the hardware team.</p>
        )}
        {one(sp.error) && <p className={`${styles.error} ${styles.result}`}>{one(sp.error)}</p>}
      </form>
    </main>
  );
}
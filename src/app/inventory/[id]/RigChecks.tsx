import { QC_LABELS } from "@/lib/labels";
import type { HardwareUpdate, QcCheck } from "@/lib/schema";
import { formatIst } from "@/lib/time";
import styles from "../../admin/admin.module.css";
import { addHardwareUpdate, addQcCheck, retireRig } from "../rig-actions";

const HARDWARE_TYPES = [
  "Inspection",
  "Repair",
  "Part replaced",
  "Cleaning",
  "Firmware update",
  "Other",
];

const QC_COLOR: Record<string, string> = {
  pass: "#15803D",
  fail: "#B42318",
  qc_pending: "#8A4B00",
  repaired: "#15803D",
};

const fieldStyle = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 } as const;

/** Hardware updates and QC results for one rig, newest first, with forms for the right teams. */
export default function RigChecks({
  itemId,
  hardwareUpdates,
  qcChecks,
  canHardware,
  canRetire = false,
  canQc,
}: {
  itemId: string;
  hardwareUpdates: HardwareUpdate[];
  qcChecks: QcCheck[];
  canHardware: boolean;
  canRetire?: boolean; // hardware team, rig is with the hardware team
  canQc: boolean;
}) {
  const latestQc = qcChecks.at(-1);

  return (
    <>
      <h2>QC</h2>
      <p>
        Current status:{" "}
        <strong style={{ color: QC_COLOR[latestQc?.qc_status ?? ""] }}>
          {latestQc ? QC_LABELS[latestQc.qc_status] ?? latestQc.qc_status : "No QC yet"}
        </strong>
      </p>

      {canQc && (
        <form action={addQcCheck} className={styles.list} aria-label="Record a QC result">
          <input type="hidden" name="itemId" value={itemId} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
            <label style={{ ...fieldStyle, flex: "0 1 220px" }}>
              <span>QC result *</span>
              <select name="qcStatus" defaultValue="" required>
                <option value="" disabled>
                  Choose
                </option>
                <option value="qc_pending">QC pending</option>
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
              </select>
            </label>
            <label style={{ ...fieldStyle, flex: "1 1 320px" }}>
              <span>Comment (required for Fail)</span>
              <input name="comment" maxLength={1000} placeholder="What was checked, what failed" />
            </label>
            <button type="submit">Save QC result</button>
          </div>
        </form>
      )}

      {qcChecks.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Result</th>
                <th>Comment</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {[...qcChecks].reverse().map((c) => (
                <tr key={c.check_id}>
                  <td>{formatIst(c.recorded_at)} IST</td>
                  <td style={{ color: QC_COLOR[c.qc_status], fontWeight: 600 }}>
                    {QC_LABELS[c.qc_status] ?? c.qc_status}
                  </td>
                  <td>{c.comment || "—"}</td>
                  <td>{c.recorded_by_name || c.recorded_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Hardware updates</h2>

      {canHardware && (
        <form action={addHardwareUpdate} className={styles.list} aria-label="Add a hardware update">
          <input type="hidden" name="itemId" value={itemId} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
            <label style={{ ...fieldStyle, flex: "0 1 220px" }}>
              <span>Update type</span>
              <select name="updateType" defaultValue="">
                <option value="">Choose</option>
                {HARDWARE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ ...fieldStyle, flex: "1 1 320px" }}>
              <span>Comment</span>
              <input name="comment" maxLength={1000} placeholder="What was done, parts used, findings" />
            </label>
            <button type="submit">Save update</button>
          </div>
        </form>
      )}

      {canRetire && (
        <form action={retireRig} className={styles.list} aria-label="Declare this rig dead">
          <input type="hidden" name="itemId" value={itemId} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end", border: "1px solid #F2C0BC", borderRadius: 8, padding: 12 }}>
            <label style={{ ...fieldStyle, flex: "1 1 320px" }}>
              <span>Declare dead: why can&apos;t it be repaired? *</span>
              <input name="reason" maxLength={1000} required placeholder="e.g. main board burnt, not repairable" />
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="confirm" required /> This rig is dead
            </label>
            <button type="submit" style={{ color: "#B42318", borderColor: "#B42318" }}>
              Declare dead / Retire
            </button>
          </div>
        </form>
      )}

      {hardwareUpdates.length === 0 ? (
        <p className={styles.muted}>No hardware updates yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Update</th>
                <th>Comment</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {[...hardwareUpdates].reverse().map((h) => (
                <tr key={h.update_id}>
                  <td>{formatIst(h.recorded_at)} IST</td>
                  <td>{h.update_type || "—"}</td>
                  <td>{h.comment || "—"}</td>
                  <td>{h.recorded_by_name || h.recorded_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
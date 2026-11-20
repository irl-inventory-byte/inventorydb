"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../form.module.css";
import SendToFields, { type PersonGroup } from "./SendToFields";

type QcResult = "" | "pass" | "fail" | "transfer";

/**
 * QC team only: a "QC result" dropdown before "Send to".
 *   Pass      → send to an IM (the rig is then QC passed, ready to deploy).
 *   Fail      → just records the Fail. NOTHING is sent anywhere — the rig stays exactly where it is,
 *               With QC team, now flagged "QC fail" on the dashboard and on Rig checks. Handing it to
 *               the hardware team is a separate, deliberate step, done later from "Handover to hardware"
 *               (/qc/handover) — never automatically here.
 *   Transfer  → hand the rig to ANOTHER QC person (no result recorded); they receive it and check it.
 * Only Pass and Transfer show the "Send to (person)" / "Send to (location)" fields below, since only
 * those two actually move the rig anywhere.
 */
export default function QcSendFields({
  groups,
  hubs,
  bangalore,
}: {
  groups: PersonGroup[];
  hubs: { id: string; name: string }[];
  bangalore?: { id: string; name: string };
}) {
  const [result, setResult] = useState<QcResult>("");
  // Who can be chosen in "Send to (person)" for each result.
  const wanted = result === "pass" ? "im" : result === "transfer" ? "qc" : "";
  const shown = groups.filter((g) => g.role === wanted);

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="qcResult">
          QC result
        </label>
        <div className={styles.control}>
          <select
            id="qcResult"
            name="qcResult"
            value={result}
            onChange={(e) => setResult(e.target.value as QcResult)}
            required
          >
            <option value="" disabled>
              Select QC result
            </option>
            <option value="pass">Pass → send to IM</option>
            <option value="fail">Fail</option>
            <option value="transfer">Transfer (another QC person)</option>
          </select>
          <p className={styles.hint}>
            Pass → an IM. Fail → just records the Fail; the rig stays with you — use the &quot;Handover
            to hardware&quot; button below when you&apos;re ready to actually send it. Transfer → another
            QC person, who receives it and checks it themselves.
          </p>
        </div>
      </div>

      {result === "fail" && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="qcComment">
            What failed
          </label>
          <div className={styles.control}>
            <textarea id="qcComment" name="qcComment" rows={3} className={styles.textarea} required />
            <p className={styles.hint}>
              Required — say what failed. Click &quot;Send items&quot; below to record it — nothing is sent
              yet, the rig just gets flagged QC fail and stays with you.
            </p>
            <Link
              href="/qc/handover"
              style={{
                display: "inline-block",
                marginTop: 10,
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--border, #e2e8f0)",
                fontWeight: 700,
              }}
            >
              Handover to hardware →
            </Link>
            <p className={styles.hint}>
              Once a rig is flagged Fail, come back here (or use this link) to actually hand it to the
              hardware team — that is a separate step, not part of recording the Fail.
            </p>
          </div>
        </div>
      )}

      {(result === "pass" || result === "transfer") &&
        (shown.length ? (
          // Changing the result resets the person, so a pass can't go to a QC person by mistake.
          <SendToFields key={result} groups={shown} hubs={hubs} allowInternal={false} bangalore={bangalore} alwaysBangalore />
        ) : (
          <p className={styles.error}>
            {result === "pass" ? "No active IM to send to." : "There is no other active QC person to send to."}
          </p>
        ))}
    </>
  );
}
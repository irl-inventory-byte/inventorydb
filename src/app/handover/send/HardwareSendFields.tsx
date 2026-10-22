"use client";

import { useState } from "react";
import styles from "../form.module.css";
import SendToFields, { type PersonGroup } from "./SendToFields";

type Outcome = "" | "repaired" | "transfer" | "dead" | "rnd";

/**
 * Hardware team only: a "Rig status" dropdown before "Send to".
 *   Repaired          → send to an IM (the rig is then RTD · Ready to deploy). Sanitization status (Yes / No)
 *                       is required and saved on the receipt.
 *   Send to hardware  → hand the rig to ANOTHER hardware person (no repair recorded); they receive it.
 *   Dead / Retired    → the rig is retired (Dead / Retired tile). A reason and a confirm tick are required.
 *   R & D             → the rig stays with you, marked R&D (R&D tile). A reason is required.
 * Dead / Retired and R & D are not sent to anyone.
 */
export default function HardwareSendFields({
  groups,
  hubs,
  bangalore,
}: {
  groups: PersonGroup[];
  hubs: { id: string; name: string }[];
  bangalore?: { id: string; name: string };
}) {
  const [outcome, setOutcome] = useState<Outcome>("");
  // Who can be chosen in "Send to (person)" for each status.
  const wanted = outcome === "repaired" ? "im" : outcome === "transfer" ? "hardware" : "";
  const shown = groups.filter((g) => g.role === wanted);

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="hwOutcome">
          Rig status
        </label>
        <div className={styles.control}>
          <select id="hwOutcome" name="hwOutcome" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} required>
            <option value="" disabled>
              Select rig status
            </option>
            <option value="repaired">Repaired → send to IM</option>
            <option value="transfer">Send to hardware (another hardware person)</option>
            <option value="dead">Dead / Retired</option>
            <option value="rnd">R &amp; D</option>
          </select>
          <p className={styles.hint}>
            Repaired → an IM. Send to hardware → another hardware person, who receives it. Dead / Retired and R &amp; D
            are not sent to anyone: the rigs leave service and show in that tile on the dashboard.
          </p>
        </div>
      </div>

      {outcome === "repaired" && (
        <div className={styles.field}>
          <span className={styles.label}>Sanitization status</span>
          <div className={styles.control}>
            <div role="radiogroup" aria-label="Sanitization status" style={{ display: "flex", gap: 20, alignItems: "center" }}>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="radio" name="sanitized" value="yes" required /> Yes
              </label>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="radio" name="sanitized" value="no" /> No
              </label>
            </div>
            <p className={styles.hint}>Was the rig sanitized before it goes back to the IM? Saved on the receipt.</p>
          </div>
        </div>
      )}

      {(outcome === "repaired" || outcome === "transfer") &&
        (shown.length ? (
          // Changing the status resets the person, so a repaired rig can't go to hardware by mistake.
          <SendToFields key={outcome} groups={shown} hubs={hubs} allowInternal={false} bangalore={bangalore} alwaysBangalore />
        ) : (
          <p className={styles.error}>
            {outcome === "repaired" ? "No active IM to send to." : "There is no other active hardware person to send to."}
          </p>
        ))}

      {(outcome === "dead" || outcome === "rnd") && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hwReason">
            {outcome === "dead" ? "Why is it dead?" : "Why R & D?"}
          </label>
          <div className={styles.control}>
            <textarea id="hwReason" name="hwReason" rows={2} className={styles.textarea} required />
            {outcome === "dead" && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                <input type="checkbox" name="hwConfirm" value="yes" required /> I confirm these rigs are dead and can&apos;t be
                repaired.
              </label>
            )}
          </div>
        </div>
      )}
    </>
  );
}
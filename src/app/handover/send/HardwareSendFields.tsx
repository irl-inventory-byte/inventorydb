"use client";

import { useState } from "react";
import styles from "../form.module.css";
import SendToFields, { type PersonGroup } from "./SendToFields";

type Outcome = "" | "repaired" | "dead" | "rnd";

/**
 * Hardware team only: a "Rig status" dropdown before "Send to".
 *   Repaired        → send to an IM (the rig is then RTD · Ready to deploy).
 *   Dead / Retired  → the rig is retired (Dead / Retired tile). A reason and a confirm tick are required.
 *   R & D           → the rig stays with you, marked R&D (R&D tile). A reason is required.
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
            <option value="repaired">Repaired</option>
            <option value="dead">Dead / Retired</option>
            <option value="rnd">R &amp; D</option>
          </select>
          <p className={styles.hint}>
            Repaired → send to an IM. Dead / Retired and R &amp; D are not sent to anyone: the rigs leave service and show
            in that tile on the dashboard.
          </p>
        </div>
      </div>

      {outcome === "repaired" && (
        <SendToFields groups={groups.filter((g) => g.role === "im")} hubs={hubs} allowInternal={false} bangalore={bangalore} alwaysBangalore />
      )}

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
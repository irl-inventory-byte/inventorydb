"use client";

import { useState } from "react";
import styles from "../form.module.css";
import SendToFields, { type PersonGroup } from "./SendToFields";

type Outcome = "" | "repaired" | "rnd" | "dead";

/**
 * Hardware team only: choose what happened to the rigs first.
 *   Repaired → send to an IM (the rig is then RTD · Ready to deploy).
 *   R&D      → the rig stays with you, marked R&D (shown in the R&D tile). A reason is required.
 *   Dead     → the rig is retired (shown in Dead / Retired). A reason is required.
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

  const choice = (value: Exclude<Outcome, "">, label: string, color: string) => (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: 40,
        padding: "6px 16px",
        border: `2px solid ${outcome === value ? color : "#b5b5b5"}`,
        borderRadius: 8,
        fontWeight: 600,
        color: outcome === value ? color : undefined,
        cursor: "pointer",
      }}
    >
      <input type="radio" name="hwOutcome" value={value} checked={outcome === value} onChange={() => setOutcome(value)} required />
      {label}
    </label>
  );

  return (
    <>
      <div className={styles.field}>
        <span className={styles.label}>Rig is</span>
        <div className={styles.control}>
          <div role="radiogroup" aria-label="What happened to the rig" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {choice("repaired", "Repaired → send to IM", "#15803D")}
            {choice("rnd", "R&D", "#1D4ED8")}
            {choice("dead", "Dead", "#B42318")}
          </div>
          <p className={styles.hint}>
            R&amp;D and Dead are not sent to anyone: the rigs leave service and show in the R&amp;D or Dead / Retired
            tile on the dashboard.
          </p>
        </div>
      </div>

      {outcome === "repaired" && (
        <SendToFields groups={groups.filter((g) => g.role === "im")} hubs={hubs} allowInternal={false} bangalore={bangalore} alwaysBangalore />
      )}

      {(outcome === "rnd" || outcome === "dead") && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="hwReason">
            {outcome === "dead" ? "Why is it dead?" : "Why R&D?"}
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
"use client";

import { useState } from "react";
import styles from "../form.module.css";
import SendToFields, { type PersonGroup } from "./SendToFields";

/**
 * QC team only: choose the QC result first, then who the rigs go to.
 *   Pass → an IM.   Fail → the hardware team (a comment is required).
 * The result is saved for every rig in this send, together with the handover.
 */
export default function QcSendFields({
  groups,
  hubs,
}: {
  groups: PersonGroup[];
  hubs: { id: string; name: string }[];
}) {
  const [result, setResult] = useState<"" | "pass" | "fail">("");
  const wanted = result === "pass" ? "im" : result === "fail" ? "hardware" : "";
  const shown = groups.filter((g) => g.role === wanted);

  const choice = (value: "pass" | "fail", label: string, color: string) => (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        minHeight: 40,
        padding: "6px 16px",
        border: `2px solid ${result === value ? color : "#b5b5b5"}`,
        borderRadius: 8,
        fontWeight: 600,
        color: result === value ? color : undefined,
        cursor: "pointer",
      }}
    >
      <input
        type="radio"
        name="qcResult"
        value={value}
        checked={result === value}
        onChange={() => setResult(value)}
        required
      />
      {label}
    </label>
  );

  return (
    <>
      <div className={styles.field}>
        <span className={styles.label}>QC result</span>
        <div className={styles.control}>
          <div role="radiogroup" aria-label="QC result" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {choice("pass", "Pass → send to IM", "#15803D")}
            {choice("fail", "Fail → send to hardware team", "#B42318")}
          </div>
        </div>
      </div>

      {result === "fail" && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="qcComment">
            What failed
          </label>
          <div className={styles.control}>
            <textarea id="qcComment" name="qcComment" rows={2} className={styles.textarea} required />
          </div>
        </div>
      )}

      {/* Changing the result resets the person, so a Pass can't go to hardware by mistake. */}
      <SendToFields key={result || "none"} groups={shown} hubs={hubs} allowInternal={false} />
    </>
  );
}
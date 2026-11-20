"use client";

import { useRef, useState } from "react";
import styles from "../../handover/form.module.css";

export interface FailedRig {
  id: string;
  label: string; // "Brand Model"
  comment: string; // what failed, from the QC check
  since: string; // formatted, when Fail was recorded
}

/**
 * Checklist of this QC person's own QC-failed rigs (tick to add to the Items box below — same pattern
 * as the Transfer between FOs checklist), plus the hardware person to hand them over to.
 */
export default function HandoverToHardwareFields({
  rigs,
  hardwarePeople,
}: {
  rigs: FailedRig[];
  hardwarePeople: { id: string; name: string }[];
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const taRef = useRef<HTMLTextAreaElement>(null);

  const toggleItem = (id: string, on: boolean) => {
    const ta = taRef.current;
    if (!ta) return;
    const lines = ta.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const set = new Set(lines);
    if (on) set.add(id);
    else set.delete(id);
    ta.value = [...set].join("\n");
    setChecked(new Set(set));
  };

  const allChecked = rigs.length > 0 && rigs.every((r) => checked.has(r.id));
  const toggleAll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (allChecked) {
      ta.value = "";
      setChecked(new Set());
    } else {
      ta.value = rigs.map((r) => r.id).join("\n");
      setChecked(new Set(rigs.map((r) => r.id)));
    }
  };

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label}>Rigs *</label>
        <div className={styles.control}>
          {rigs.length === 0 ? (
            <p className={styles.hint}>No QC-failed rigs with you right now.</p>
          ) : (
            <>
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontWeight: 600 }}>
                <input type="checkbox" checked={allChecked} onChange={toggleAll} /> Select all ({rigs.length})
              </label>
              <div
                style={{
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: 8,
                  maxHeight: 280,
                  overflowY: "auto",
                }}
              >
                {rigs.map((r) => (
                  <label
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 10px",
                      borderBottom: "1px solid var(--border, #e2e8f0)",
                      fontSize: 13,
                    }}
                  >
                    <input type="checkbox" checked={checked.has(r.id)} onChange={(e) => toggleItem(r.id, e.target.checked)} />
                    <span style={{ flex: 1 }}>
                      <strong>{r.id}</strong> — {r.label}
                      {r.comment && <span className={styles.hint}> ({r.comment})</span>}
                    </span>
                    <span className={styles.hint} style={{ whiteSpace: "nowrap" }}>
                      failed {r.since}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          <textarea
            id="scanned"
            name="scanned"
            ref={taRef}
            rows={4}
            className={styles.textarea}
            placeholder="Or type/scan rig IDs here, one per line."
            style={{ marginTop: 8 }}
            required
          />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="recipient">
          Send to hardware *
        </label>
        <div className={styles.control}>
          <select id="recipient" name="recipient" required defaultValue="">
            <option value="" disabled>
              Select a hardware person
            </option>
            {hardwarePeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className={styles.hint}>They receive it on Receive items — the usual hand-off handshake.</p>
        </div>
      </div>
    </>
  );
}
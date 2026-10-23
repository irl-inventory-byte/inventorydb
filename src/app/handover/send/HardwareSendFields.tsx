"use client";

import { useEffect, useState } from "react";
import { collectIds } from "@/lib/scan";
import styles from "../form.module.css";
import SendToFields, { type PersonGroup } from "./SendToFields";

type Outcome = "" | "repaired" | "transfer" | "dead" | "rnd";

/**
 * Hardware team only: a "Rig status" dropdown before "Send to".
 *   Repaired          → send to an IM (the rig is then RTD · Ready to deploy). Sanitization status (Yes / No)
 *                       is chosen for EACH scanned rig and saved on the receipt and the rig's history.
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

  // The rigs scanned in the box above (read every half second, so camera scans show up too).
  const [rigs, setRigs] = useState<string[]>([]);
  const [sanitized, setSanitized] = useState<Record<string, "yes" | "no">>({});
  useEffect(() => {
    const read = () => {
      const box = document.querySelector<HTMLTextAreaElement>('textarea[name="scanned"]');
      const next = [...new Set(collectIds(box?.value ?? "").map((c) => c.trim().toUpperCase()).filter(Boolean))];
      setRigs((old) => (old.join("\n") === next.join("\n") ? old : next));
    };
    read();
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, []);
  const pick = (rig: string, v: "yes" | "no") => setSanitized((old) => ({ ...old, [rig]: v }));
  const allYes = () => setSanitized(Object.fromEntries(rigs.map((r) => [r, "yes" as const])));
  const chosen = Object.fromEntries(rigs.filter((r) => sanitized[r]).map((r) => [r, sanitized[r]]));
  const missing = rigs.filter((r) => !sanitized[r]).length;

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
            <input type="hidden" name="sanitizedMap" value={JSON.stringify(chosen)} />
            {rigs.length === 0 ? (
              <p className={styles.hint}>Scan the rigs first. Each scanned rig then gets a Yes / No here.</p>
            ) : (
              <>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" }}>
                  {rigs.map((rig, n) => (
                    <div
                      key={rig}
                      role="radiogroup"
                      aria-label={`Sanitization for ${rig}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 16,
                        padding: "8px 12px",
                        borderTop: n ? "1px solid #e5e7eb" : "none",
                        background: sanitized[rig] ? "#ffffff" : "#fffbeb",
                      }}
                    >
                      <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{rig}</code>
                      <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input type="radio" name={`san-${rig}`} checked={sanitized[rig] === "yes"} onChange={() => pick(rig, "yes")} /> Yes
                      </label>
                      <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input type="radio" name={`san-${rig}`} checked={sanitized[rig] === "no"} onChange={() => pick(rig, "no")} /> No
                      </label>
                    </div>
                  ))}
                </div>
                <p className={styles.hint} style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <span>
                    Was each rig sanitized before it goes back to the IM? Saved on the receipt.
                    {missing > 0 && <b> {missing} still to choose.</b>}
                  </span>
                  {rigs.length > 1 && (
                    <button type="button" onClick={allYes} style={{ background: "none", border: "none", padding: 0, color: "#1d4ed8", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
                      Mark all Yes
                    </button>
                  )}
                </p>
              </>
            )}
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
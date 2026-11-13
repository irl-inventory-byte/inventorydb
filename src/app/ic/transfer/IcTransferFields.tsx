"use client";

import { useState } from "react";
import type { Status } from "@/lib/schema";
import styles from "../../handover/form.module.css";
import ScanBox from "../../handover/ScanBox";

/**
 * Items + Send to (person), for the IC Transfer page. "Sending from" and "Send to (location)" are both
 * fixed to Bangalore elsewhere on the page (lib/rig-hub.ts's rigHomeHub) — not shown here as choices.
 */
export default function IcTransferFields({
  items,
  hubName,
  fos,
}: {
  items: { id: string; status: Status; hub: string; type?: string; aliases?: string[] }[];
  hubName: string;
  fos: { id: string; label: string }[];
}) {
  const [recipient, setRecipient] = useState("");

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="scanned">
          Items
        </label>
        <div className={styles.control}>
          <ScanBox id="scanned" mode="send" hubNames={{}} items={items} />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="recipient">
          Send to (person)
        </label>
        <div className={styles.control}>
          <select
            id="recipient"
            name="recipient"
            required
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          >
            <option value="">Select a field officer</option>
            {fos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <input type="hidden" name="recipientRole" value="fo" />
          <p className={styles.hint}>IC can only transfer to a field officer (FO).</p>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Send to (location)</label>
        <div className={styles.control}>
          <strong>{hubName}</strong>
          <p className={styles.hint}>Always recorded at Bangalore, whichever FO you choose.</p>
        </div>
      </div>
    </>
  );
}
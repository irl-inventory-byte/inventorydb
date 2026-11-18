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
  fos: { id: string; name: string; city: string }[];
}) {
  const [recipient, setRecipient] = useState("");
  // City picked first, to narrow a long flat FO list down to one place before naming someone. Changing
  // city clears whatever FO was picked for the old one, so the two selects can't end up out of sync.
  const [city, setCity] = useState("");
  const cities = [...new Set(fos.map((f) => f.city))].sort((a, b) => a.localeCompare(b));
  const fosInCity = fos.filter((f) => f.city === city);

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
        <label className={styles.label} htmlFor="recipientCity">
          Send to (person)
        </label>
        <div className={styles.control}>
          <select
            id="recipientCity"
            value={city}
            onChange={(e) => {
              setCity(e.target.value);
              setRecipient(""); // the previously picked FO may not even be in the new city
            }}
          >
            <option value="">Select a city</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            id="recipient"
            name="recipient"
            required
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={!city}
            style={{ marginTop: 8 }}
          >
            <option value="">{city ? "Select a field officer" : "Pick a city first"}</option>
            {fosInCity.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
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
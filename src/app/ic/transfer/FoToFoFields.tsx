"use client";

import { useState } from "react";
import styles from "../../handover/form.module.css";

/**
 * Items + Send to (person), for the "Transfer between FOs" section of the IC Transfer page (see
 * app/ic/actions.ts's transferFoToFo). Items are typed/scanned IDs, not picked off a scan box tied to
 * one hub's in-stock list — these items are already with an FO somewhere, not in Bangalore stock, so
 * there's no single "current location" list to scan against here. The server validates that each one
 * is actually "with_fo" before moving it.
 */
export default function FoToFoFields({ fos }: { fos: { id: string; name: string; city: string }[] }) {
  const [recipient, setRecipient] = useState("");
  const [city, setCity] = useState("");
  const cities = [...new Set(fos.map((f) => f.city))].sort((a, b) => a.localeCompare(b));
  const fosInCity = fos.filter((f) => f.city === city);

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="foScanned">
          Items
        </label>
        <div className={styles.control}>
          <textarea
            id="foScanned"
            name="scanned"
            rows={6}
            className={styles.textarea}
            placeholder="Type or scan item IDs here, one per line."
            required
          />
          <p className={styles.hint}>Only items currently with an FO can be moved this way.</p>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="foRecipientCity">
          Send to (person)
        </label>
        <div className={styles.control}>
          <select
            id="foRecipientCity"
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
            id="foRecipient"
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
          <p className={styles.hint}>Moves directly to this FO — happens immediately, no confirmation needed from either side.</p>
        </div>
      </div>
    </>
  );
}
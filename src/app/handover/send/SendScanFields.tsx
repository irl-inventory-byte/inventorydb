"use client";

import { useState } from "react";
import type { Status } from "@/lib/schema";
import styles from "../form.module.css";
import ScanBox from "../ScanBox";

/**
 * "Sending from" and the scan box, together so the box can flag any scanned card that is not in stock
 * at the chosen hub while you scan.
 */
export default function SendScanFields({
  hubs,
  defaultHub,
  items,
}: {
  hubs: { id: string; name: string }[];
  defaultHub: string;
  items: { id: string; status: Status; hub: string; type?: string }[];
}) {
  const [hub, setHub] = useState(defaultHub);
  const hubNames = Object.fromEntries(hubs.map((h) => [h.id, h.name]));

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="fromHub">
          Sending from
        </label>
        <div className={styles.control}>
          <select id="fromHub" name="fromHub" value={hub} onChange={(e) => setHub(e.target.value)} required>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <p className={styles.hint}>The hub the items are leaving. Every item must be in stock there.</p>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="scanned">
          Items
        </label>
        <div className={styles.control}>
          <ScanBox id="scanned" mode="send" hub={hub} hubNames={hubNames} items={items} />
        </div>
      </div>
    </>
  );
}
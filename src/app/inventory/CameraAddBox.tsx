"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CameraScanButton, { type ScanOutcome } from "../CameraScanButton";
import styles from "../camerascan.module.css";

/**
 * The Add pages' camera: each scanned code is saved to the inventory straight away (by `save`), and
 * every scanned ID / serial is listed here, under the button, with its result.
 */
export default function CameraAddBox({
  save,
  onOpen,
}: {
  save: (code: string) => Promise<ScanOutcome>;
  onOpen?: () => boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<{ key: number; code: string; outcome: ScanOutcome }[]>([]);
  const saved = rows.filter((r) => r.outcome.ok).length;

  return (
    <div>
      <CameraScanButton
        label="Scan & add with camera"
        onOpen={onOpen}
        onScan={save}
        onResult={(code, outcome) => setRows((list) => [{ key: Date.now() + list.length, code, outcome }, ...list])}
        onClose={(ok) => ok > 0 && router.refresh()}
      />
      {rows.length > 0 && (
        <div className={styles.added} aria-live="polite">
          <div className={styles.addedHead}>
            <strong>Added with camera</strong>
            <span>
              {saved} saved{rows.length > saved ? ` · ${rows.length - saved} not saved` : ""}
            </span>
            <button type="button" className={styles.addedClear} onClick={() => setRows([])}>
              Clear
            </button>
          </div>
          <ul className={styles.addedList}>
            {rows.map((r) => (
              <li key={r.key} className={r.outcome.ok ? styles.addedOk : styles.addedBad}>
                <span aria-hidden>{r.outcome.ok ? "✓" : "✕"}</span>
                <code>{r.outcome.id ?? r.code}</code>
                {r.outcome.type && <span className={styles.addedType}>{r.outcome.type}</span>}
                <span>{r.outcome.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

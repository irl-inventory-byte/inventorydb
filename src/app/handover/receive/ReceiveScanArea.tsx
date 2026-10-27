"use client";

import { useEffect, useRef, useState } from "react";
import type { Status } from "@/lib/schema";
import styles from "../../admin/admin.module.css";
import formStyles from "../form.module.css";
import CameraScanButton from "../../CameraScanButton";
import ScanBox from "../ScanBox";
import { lookupBatch } from "./lookupBatch";

/**
 * Receive's scan area: a batch-receipt field above the card scan box. Scanning (or pasting) the QR from a
 * send receipt loads every card in that batch into the box in one go; individual cards can still be
 * scanned or added the same way as before.
 */
export default function ReceiveScanArea({
  hub,
  hubNames,
  items,
  allowed,
}: {
  hub: string;
  hubNames: Record<string, string>;
  items: { id: string; status: Status; hub: string; type?: string; aliases?: string[] }[];
  allowed?: readonly string[]; // QC / hardware team: only rigs sent to them
}) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [injected, setInjected] = useState<{ ids: string[]; nonce: number }>({ ids: [], nonce: 0 });
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  async function load(value = code) {
    if (!value.trim() || pending) return;
    setPending(true);
    try {
      const result = await lookupBatch(value);
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setInjected({ ids: result.ids, nonce: Date.now() });
        setCode("");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.list}>
      <div className={formStyles.field} style={{ gridTemplateColumns: "190px 1fr" }}>
        <label className={formStyles.label} htmlFor="batch-code">
          Batch receipt
        </label>
        <div className={formStyles.control}>
          <div className={styles.row}>
            <input
              id="batch-code"
              ref={ref}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                // Prevent Enter from submitting the Receive form; this field is not part of it.
                if (e.key === "Enter") {
                  e.preventDefault();
                  void load();
                }
              }}
              placeholder="Scan or paste the QR / code from a send receipt"
              autoComplete="off"
            />
            <button type="button" onClick={() => void load()} disabled={pending}>
              {pending ? "Loading…" : "Load batch"}
            </button>
            <CameraScanButton
              label="Scan receipt QR"
              onScan={(value) => {
                setCode(value);
                void load(value);
              }}
            />
          </div>
          {message && <p className={message.ok ? styles.ok : styles.error}>{message.text}</p>}
          <p className={formStyles.hint}>
            Loads every item from that batch into the box below at once, skipping any already there.
          </p>
        </div>
      </div>

      <ScanBox
        id="scanned"
        mode="receive"
        hub={hub}
        hubNames={hubNames}
        items={items}
        allowed={allowed}
        autoFocus={false}
        injected={injected}
      />
    </div>
  );
}
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QC_LABELS, STATUS_LABELS } from "@/lib/labels";
import { classifyScans, type ScanState } from "@/lib/scan";
import { OUT_STATUSES, type Status } from "@/lib/schema";
import CameraScanButton, { appendLine } from "../CameraScanButton";
import { TypeBadge, TypeCounts } from "../ItemTypeBadge";
import styles from "./scanbox.module.css";

// What each action accepts: sending needs stock, receiving needs a card that is out.
const ALLOWED = {
  send: new Set<string>(["in_stock"]),
  receive: new Set<string>(OUT_STATUSES),
};
const WRONG_HINT = { send: "not in stock, can't be sent", receive: "not waiting to be received" };

const MARK: Record<ScanState, string> = { ok: "✓", wrong: "✕", unknown: "✕", duplicate: "•" };

/**
 * The scan box. It keeps the cursor here, treats a Tab after a scan like Enter (some scanners send
 * Tab), and shows every scanned line as it arrives so a problem with the scanner or a code is visible
 * before anything is saved.
 */
export default function ScanBox({
  id,
  items,
  mode,
  rows = 8,
  hub,
  hubNames = {},
  allowed,
  autoFocus = true,
  injected,
}: {
  id: string;
  items: { id: string; status: Status; hub: string; type?: string; qc?: string; note?: string; aliases?: string[] }[];
  mode: "send" | "receive";
  allowed?: readonly string[]; // send only: statuses that can be sent, instead of "in stock" (QC / hardware teams)
  rows?: number;
  hub?: string; // receive only: the hub chosen in "Receiving at"
  hubNames?: Record<string, string>;
  autoFocus?: boolean; // false when something else on the page (e.g. a batch code field) should get focus first
  injected?: { ids: string[]; nonce: number }; // ids to add from elsewhere on the page (e.g. a scanned batch receipt)
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
    // Only on mount: this reflects where focus should start, not a live sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cards found by a batch lookup are added like scans, skipping ones already in the box. Adjusted during
  // render (not in an effect): each lookup bumps `nonce`, and noticing it changed here, once, is the
  // recommended way to react to it without an extra render-then-effect round trip.
  const [seenNonce, setSeenNonce] = useState(injected?.nonce ?? 0);
  if (injected && injected.nonce !== seenNonce) {
    setSeenNonce(injected.nonce);
    const already = new Set(
      text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const toAdd = injected.ids.filter((id) => !already.has(id));
    if (toAdd.length > 0) {
      const base = text.trim();
      setText(base ? `${base}\n${toAdd.join("\n")}\n` : `${toAdd.join("\n")}\n`);
    }
  }

  const statuses = useMemo(() => new Map<string, string>(items.map((i) => [i.id, i.status])), [items]);
  const results = useMemo(() => {
    const placeOf = new Map(items.map((i) => [i.id, i.hub]));
    const accepts = allowed ? new Set<string>(allowed) : ALLOWED[mode];
    // Mobiles: found by an IMEI in the QR code ("IMEI1 - IMEI2"), the Asset Tag or the Serial.
    const phones = new Map(items.filter((i) => i.type === "mobile").map((i) => [i.id, i.aliases ?? []]));
    return classifyScans(text, statuses, accepts, phones).map((r) => {
      // Say so before submitting when a card is at a different hub than the one chosen: a card sent to a
      // hub must be received there, and cards must be in stock at the hub they are sent from.
      const sentTo = r.id ? placeOf.get(r.id) : undefined;
      const elsewhere = mode === "send" || r.status === "pending";
      if (hub && r.state === "ok" && elsewhere && sentTo && sentTo !== hub) {
        return { ...r, state: "wrong" as ScanState, sentTo };
      }
      return { ...r, sentTo: undefined };
    });
  }, [text, statuses, items, mode, hub, allowed]);
  // A rig's latest QC result, shown next to it so the rig route is clear while scanning.
  const qcOf = useMemo(
    () =>
      new Map(
        items
          .filter((i) => i.note || i.qc)
          .map((i) => [i.id, i.note ?? `QC: ${QC_LABELS[i.qc!] ?? i.qc}`])
      ),
    [items]
  );
  const ok = results.filter((r) => r.state === "ok").length;
  // SD card or Rig for each matched item, so mixed batches are easy to check.
  const typeOf = useMemo(() => new Map(items.map((i) => [i.id, i.type ?? "sd_card"])), [items]);
  const okTypes = results.filter((r) => r.state === "ok" && r.id).map((r) => typeOf.get(r.id!));
  const problems = results.filter((r) => r.state === "wrong" || r.state === "unknown").length;

  return (
    <div className={styles.box}>
      <div className={styles.top}>
        <div className={`${styles.state} ${focused ? styles.stateOn : ""}`} aria-live="polite">
          {focused ? "Ready to scan" : "Click the box below before scanning"}
        </div>
        <CameraScanButton multiple onScan={(code) => setText((t) => appendLine(t, code))} />
      </div>
      <textarea
        id={id}
        ref={ref}
        name="scanned"
        rows={rows}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          // A scanner that ends with Tab would move focus away. Keep it here and start a new line.
          if (e.key === "Tab" && !e.shiftKey && text.trim() !== "") {
            e.preventDefault();
            setText((t) => (t.endsWith("\n") ? t : `${t}\n`));
          }
        }}
        placeholder="Scan items here. Each code should appear on its own line."
        className={styles.textarea}
        spellCheck={false}
        autoComplete="off"
      />

      {results.length > 0 && (
        <div className={styles.summary}>
          <strong>{results.length}</strong> scanned · <strong>{ok}</strong> ready
          {problems > 0 && <span className={styles.bad}> · {problems} problem(s)</span>}
          {okTypes.length > 0 && (
            <span style={{ marginLeft: 10 }}>
              <TypeCounts types={okTypes} />
            </span>
          )}
          <button type="button" className={styles.clear} onClick={() => setText("")}>
            Clear
          </button>
        </div>
      )}
      {results.some((r) => r.id && r.id !== r.code) && (
        <p className={styles.caseNote}>
          Some codes arrived in a different letter case, so Caps Lock may be on. They were matched anyway.
        </p>
      )}
      {results.length > 0 && (
        <ul className={styles.list} aria-label="Scanned items">
          {[...results].reverse().map((r, i) => (
            <li key={`${r.code}-${i}`} className={r.state === "ok" ? styles.ok : r.state === "duplicate" ? styles.dup : styles.bad}>
              <span aria-hidden>{MARK[r.state]}</span>
              {r.id && typeOf.has(r.id) && <TypeBadge type={typeOf.get(r.id)} />}
              <code>{r.id ?? r.code}</code>
              <span className={styles.msg}>
                {r.state === "ok" && (STATUS_LABELS[r.status as Status] ?? r.status)}
                {r.id && qcOf.has(r.id) && ` · ${qcOf.get(r.id)}`}
                {r.state === "wrong" &&
                  (r.sentTo
                    ? mode === "send"
                      ? `at ${hubNames[r.sentTo] ?? r.sentTo}: choose that hub in "Sending from"`
                      : `sent to ${hubNames[r.sentTo] ?? r.sentTo}: switch "Receiving at" to that hub`
                    : `${STATUS_LABELS[r.status as Status] ?? r.status}: ${WRONG_HINT[mode]}`)}
                {r.state === "unknown" && `not found in the inventory (${r.code.length} characters): ${r.code}`}
                {r.state === "duplicate" && "scanned twice, counted once"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
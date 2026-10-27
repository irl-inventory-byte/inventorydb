"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import CameraScanButton from "../CameraScanButton";
import { cameraAddRig } from "./camera-add";
import styles from "../admin/admin.module.css";
import { addRigs, checkRigs, type RigBulkResult, type RigCheck } from "./rig-actions";

type Row = RigCheck & { key: string };

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const inputStyle: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px" };
const cellStyle: CSSProperties = { padding: "8px 10px", textAlign: "left", verticalAlign: "middle", whiteSpace: "nowrap" };

const splitIds = (text: string) =>
  text
    .split(/[\n,\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const rupees = (v: string) => (v ? `₹${Number(v).toLocaleString("en-IN")}` : "—");

function checkLabel(row: Row): { text: string; color: string } {
  if (row.status === "exists") return { text: "Already in inventory", color: "#8A4B00" };
  if (row.status === "repeated") return { text: "Repeated in list", color: "#8A4B00" };
  if (row.status === "notfound") return { text: "Not in rig sheet – use Add a rig", color: "#B42318" };
  if (row.status === "nopenalty") return { text: "No penalty in sheet – use Add a rig", color: "#B42318" };
  return { text: "Ready", color: "#15803D" };
}

/** Add many rigs at once: home hub Bangalore, details and penalty from the rig sheet, QC pending. */
export default function RigBulkAddForm({ homeHubName }: { homeHubName?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [checking, setChecking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<RigBulkResult | null>(null);

  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      requestId.current += 1;
    },
    []
  );

  async function check(value: string) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setWaiting(false);
    const ids = splitIds(value);
    const current = ++requestId.current;
    if (!ids.length) {
      setRows([]);
      setChecking(false);
      return;
    }
    setChecking(true);
    setMessage("");
    try {
      const found = await checkRigs(ids);
      if (current !== requestId.current) return;
      if (found.error) setMessage(found.error);
      setRows(found.rows.map((r, i) => ({ ...r, key: `${r.rigId}-${i}` })));
      if (ids.length > found.rows.length && !found.error) {
        setMessage(`Only the first ${found.rows.length} rig IDs were checked. Add the rest in another batch.`);
      }
    } catch {
      if (current !== requestId.current) return;
      setMessage("Could not read the rig sheet. Try Fetch details again.");
    } finally {
      if (current === requestId.current) setChecking(false);
    }
  }

  function changeText(value: string) {
    setText(value);
    setResult(null);
    if (timer.current) clearTimeout(timer.current);
    setWaiting(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      void check(value);
    }, 800);
  }

  function removeRow(key: string) {
    setRows((current) => {
      const next = current.filter((r) => r.key !== key);
      setText(next.map((r) => r.rigId).join("\n"));
      return next;
    });
  }

  const ready = rows.filter((r) => r.status === "ready");
  const busy = checking || saving || waiting;

  async function save() {
    if (!ready.length) return;
    setSaving(true);
    setResult(null);
    setMessage("");
    try {
      const outcome = await addRigs(ready.map((r) => r.rigId));
      setResult(outcome);
      if (outcome.added.length) {
        const added = new Set(outcome.added.map((s) => s.toUpperCase()));
        const left = rows.filter((r) => !added.has(r.rigId.toUpperCase()));
        setRows(left);
        setText(left.map((r) => r.rigId).join("\n"));
        router.refresh();
      }
    } catch {
      setMessage("Could not save. Nothing was added. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={fieldStyle}>
          <span>Home hub</span>
          <strong style={{ padding: "10px 0" }}>{homeHubName || "Bangalore"}</strong>
          <small className={styles.muted}>Every rig is added to Bangalore.</small>
        </div>

        <label style={{ ...fieldStyle, gridColumn: "span 2" }}>
          <span>Rig ID / Asset Tags *</span>
          <textarea
            value={text}
            onChange={(e) => changeText(e.target.value)}
            rows={5}
            placeholder="Scan or paste rig IDs, one per line"
            autoComplete="off"
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
          />
          <small className={styles.muted}>
            One per line (you can paste a whole column from the rig sheet). Details load automatically.
          </small>
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <CameraScanButton
          label="Scan & add with camera"
          onScan={cameraAddRig}
          onClose={(saved) => saved > 0 && router.refresh()}
        />
        <button type="button" disabled={checking || !text.trim()} onClick={() => void check(text)}>
          {checking ? "Fetching…" : "Fetch details"}
        </button>
        {rows.length > 0 && (
          <span className={styles.muted}>
            {rows.length} checked · {ready.length} ready
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd" }}>
                <th style={cellStyle}>#</th>
                <th style={cellStyle}>Rig ID / Asset Tag</th>
                <th style={cellStyle}>Brand</th>
                <th style={cellStyle}>Model</th>
                <th style={cellStyle}>Penalty amount</th>
                <th style={cellStyle}>Check</th>
                <th style={cellStyle} aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const label = checkLabel(row);
                return (
                  <tr key={row.key} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={cellStyle}>{i + 1}</td>
                    <td style={{ ...cellStyle, fontFamily: "monospace" }}>{row.rigId}</td>
                    <td style={cellStyle}>{row.brand || "—"}</td>
                    <td style={cellStyle}>{row.model || "—"}</td>
                    <td style={cellStyle}>{rupees(row.penalty)}</td>
                    <td style={{ ...cellStyle, color: label.color, fontWeight: 600 }}>{label.text}</td>
                    <td style={cellStyle}>
                      <button type="button" onClick={() => removeRow(row.key)} aria-label={`Remove ${row.rigId}`} title="Remove from list">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <span>
            <strong>{ready.length}</strong> rig{ready.length === 1 ? "" : "s"} will be added to{" "}
            <strong>{homeHubName || "Bangalore"}</strong> with QC pending. Only rows marked Ready are added.
          </span>
          <button type="button" disabled={busy || !ready.length} onClick={() => void save()}>
            {saving ? "Saving…" : `Add ${ready.length} rig${ready.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {checking && <p className={styles.muted} style={{ margin: 0 }}>Looking up rig details…</p>}
        {message && <p className={styles.error} style={{ margin: 0 }}>{message}</p>}
        {result?.error && <p className={styles.error} style={{ margin: 0 }}>{result.error}</p>}
        {result && result.added.length > 0 && (
          <p className={styles.ok} style={{ margin: 0 }}>
            Added {result.added.length} rig{result.added.length === 1 ? "" : "s"}: {result.added.join(", ")}.
          </p>
        )}
        {result && result.skipped.length > 0 && (
          <p className={styles.error} style={{ margin: 0 }}>
            Skipped {result.skipped.length}: {result.skipped.map((s) => `${s.rigId} (${s.reason})`).join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}
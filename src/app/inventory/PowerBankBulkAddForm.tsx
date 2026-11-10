"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import styles from "../admin/admin.module.css";
import { addPowerBanks, checkPowerBanks, type PowerBankBulkResult, type PowerBankCheck } from "./power-bank-actions";

type Row = PowerBankCheck & { key: string };
type Hubs = { hub_id: string; name: string }[];

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const inputStyle: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px" };
const cellStyle: CSSProperties = { padding: "8px 10px", textAlign: "left", verticalAlign: "middle", whiteSpace: "nowrap" };

// One Asset Tag per line.
const splitScans = (text: string) =>
  text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

const rupees = (v: string) => (v ? `₹${Number(v).toLocaleString("en-IN")}` : "—");

function checkLabel(row: Row): { text: string; color: string } {
  if (row.status === "exists") return { text: "Already in inventory", color: "#8A4B00" };
  if (row.status === "repeated") return { text: "Repeated in list", color: "#8A4B00" };
  if (row.status === "notfound") return { text: "Not in power bank sheet – use Add a power bank", color: "#B42318" };
  return { text: "Ready", color: "#15803D" };
}

/** Add many power banks at once: scan or paste Asset Tags, one per line. Details from the power bank sheet. */
export default function PowerBankBulkAddForm({ hubs = [] }: { hubs?: Hubs }) {
  const router = useRouter();
  const [homeHub, setHomeHub] = useState("");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [checking, setChecking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");
  const [result, setResult] = useState<PowerBankBulkResult | null>(null);

  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      requestId.current += 1;
    },
    [],
  );

  async function check(value: string) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setWaiting(false);
    const scans = splitScans(value);
    const current = ++requestId.current;
    if (!scans.length) {
      setRows([]);
      setChecking(false);
      return;
    }
    setChecking(true);
    setMessage("");
    try {
      const found = await checkPowerBanks(scans);
      if (current !== requestId.current) return;
      if (found.error) setMessage(found.error);
      setInfo(found.info ?? "");
      setRows(found.rows.map((r, i) => ({ ...r, key: `${r.scanned}-${i}` })));
      if (scans.length > found.rows.length && !found.error) {
        setMessage(`Only the first ${found.rows.length} scans were checked. Add the rest in another batch.`);
      }
    } catch {
      if (current !== requestId.current) return;
      setMessage("Could not read the power bank sheet. Try Fetch details again.");
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
      setText(next.map((r) => r.scanned).join("\n"));
      return next;
    });
  }

  const ready = rows.filter((r) => r.status === "ready");
  const busy = checking || saving || waiting || !homeHub;

  async function save() {
    if (!ready.length || !homeHub) return;
    setSaving(true);
    setResult(null);
    setMessage("");
    try {
      const outcome = await addPowerBanks(ready.map((r) => r.scanned), homeHub);
      setResult(outcome);
      if (outcome.added.length) {
        const added = new Set(outcome.added);
        const left = rows.filter((r) => !added.has(r.assetTag));
        setRows(left);
        setText(left.map((r) => r.scanned).join("\n"));
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
        <label style={fieldStyle}>
          <span>Home hub *</span>
          <select value={homeHub} onChange={(e) => setHomeHub(e.target.value)} required style={inputStyle}>
            <option value="" disabled>
              Select home hub
            </option>
            {hubs.map((hub) => (
              <option key={hub.hub_id} value={hub.hub_id}>
                {hub.name}
              </option>
            ))}
          </select>
          <small className={styles.muted}>Every power bank in this batch is added to this hub.</small>
        </label>

        <label style={{ ...fieldStyle, gridColumn: "span 2" }}>
          <span>Asset Tags *</span>
          <textarea
            value={text}
            onChange={(e) => changeText(e.target.value)}
            rows={6}
            placeholder="Scan the QR codes one after another, or paste Asset Tags, one per line"
            autoComplete="off"
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
          />
          <small className={styles.muted}>One power bank per line. Details load automatically from the power bank sheet.</small>
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <button type="button" disabled={checking || !text.trim()} onClick={() => void check(text)}>
          {checking ? "Fetching…" : "Fetch details"}
        </button>
        {rows.length > 0 && (
          <span className={styles.muted}>
            {rows.length} checked · {ready.length} ready{info ? ` · ${info}` : ""}
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd" }}>
                <th style={cellStyle}>#</th>
                <th style={cellStyle}>Asset Tag</th>
                <th style={cellStyle}>Date</th>
                <th style={cellStyle}>Brand</th>
                <th style={cellStyle}>Model</th>
                <th style={cellStyle}>Color</th>
                <th style={cellStyle}>Capacity</th>
                <th style={cellStyle}>Output</th>
                <th style={cellStyle}>Price / Penalty</th>
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
                    <td style={{ ...cellStyle, fontFamily: "monospace" }}>{row.assetTag || row.scanned.slice(0, 30)}</td>
                    <td style={cellStyle}>{row.date || "—"}</td>
                    <td style={cellStyle}>{row.brand || "—"}</td>
                    <td style={cellStyle}>{row.model || "—"}</td>
                    <td style={cellStyle}>{row.color || "—"}</td>
                    <td style={cellStyle}>{row.capacity || "—"}</td>
                    <td style={cellStyle}>{row.output || "—"}</td>
                    <td style={cellStyle}>{rupees(row.price)}</td>
                    <td style={{ ...cellStyle, color: label.color, fontWeight: 600 }}>{label.text}</td>
                    <td style={cellStyle}>
                      <button type="button" onClick={() => removeRow(row.key)} aria-label={`Remove ${row.assetTag || row.scanned}`} title="Remove from list">
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
            <strong>{ready.length}</strong> power bank{ready.length === 1 ? "" : "s"} will be added
            {homeHub ? <> to the hub you chose</> : ""}. Only rows marked Ready are added.
          </span>
          <button type="button" disabled={busy || !ready.length} onClick={() => void save()}>
            {saving ? "Saving…" : `Add ${ready.length} power bank${ready.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {!homeHub && rows.length > 0 && (
          <p className={styles.error} style={{ margin: 0 }}>
            Select the home hub before saving.
          </p>
        )}
        {checking && <p className={styles.muted} style={{ margin: 0 }}>Looking up power bank details…</p>}
        {message && <p className={styles.error} style={{ margin: 0 }}>{message}</p>}
        {result?.error && <p className={styles.error} style={{ margin: 0 }}>{result.error}</p>}
        {result && result.added.length > 0 && (
          <p className={styles.ok} style={{ margin: 0 }}>
            Added {result.added.length} power bank{result.added.length === 1 ? "" : "s"}: {result.added.join(", ")}.
          </p>
        )}
        {result && result.skipped.length > 0 && (
          <p className={styles.error} style={{ margin: 0 }}>
            Skipped {result.skipped.length}: {result.skipped.map((s) => `${s.assetTag} (${s.reason})`).join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}
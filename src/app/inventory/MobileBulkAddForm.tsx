"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import CameraAddBox from "./CameraAddBox";
import { cameraAddMobile } from "./camera-add";
import styles from "../admin/admin.module.css";
import { addMobiles, checkMobiles, type MobileBulkResult, type MobileCheck } from "./mobile-actions";

type Row = MobileCheck & { key: string };

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const inputStyle: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px" };
const cellStyle: CSSProperties = { padding: "8px 10px", textAlign: "left", verticalAlign: "middle", whiteSpace: "nowrap" };

// One scan per line. A QR code may hold "IMEI1: … IMEI2: …" on one line: that is one phone.
const splitScans = (text: string) =>
  text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

const rupees = (v: string) => (v ? `₹${Number(v).toLocaleString("en-IN")}` : "—");

function checkLabel(row: Row): { text: string; color: string } {
  if (row.status === "exists") return { text: "Already in inventory", color: "#8A4B00" };
  if (row.status === "repeated") return { text: "Repeated in list", color: "#8A4B00" };
  if (row.status === "notfound") return { text: "Not in mobile sheet – use Add a mobile", color: "#B42318" };
  if (row.status === "noimei") return { text: "No IMEI for this phone in the sheet", color: "#B42318" };
  return { text: "Ready", color: "#15803D" };
}

/** Add many mobiles at once: scan QR codes one after another. Details from the mobile sheet. */
export default function MobileBulkAddForm({ homeHubName }: { homeHubName?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [checking, setChecking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [info, setInfo] = useState("");
  const [result, setResult] = useState<MobileBulkResult | null>(null);

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
      const found = await checkMobiles(scans);
      if (current !== requestId.current) return;
      if (found.error) setMessage(found.error);
      setInfo(found.info ?? "");
      setRows(found.rows.map((r, i) => ({ ...r, key: `${r.scanned}-${i}` })));
      if (scans.length > found.rows.length && !found.error) {
        setMessage(`Only the first ${found.rows.length} scans were checked. Add the rest in another batch.`);
      }
    } catch {
      if (current !== requestId.current) return;
      setMessage("Could not read the mobile sheet. Try Fetch details again.");
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
  const busy = checking || saving || waiting || !homeHubName;

  async function save() {
    if (!ready.length) return;
    setSaving(true);
    setResult(null);
    setMessage("");
    try {
      const outcome = await addMobiles(ready.map((r) => r.scanned));
      setResult(outcome);
      if (outcome.added.length) {
        const added = new Set(outcome.added);
        const left = rows.filter((r) => !added.has(r.imei));
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
        <div style={fieldStyle}>
          <span>Home hub</span>
          <strong style={{ padding: "10px 0" }}>{homeHubName || "Instawork Robotics Labs"}</strong>
          <small className={styles.muted}>Every mobile is added to this hub.</small>
        </div>

        <label style={{ ...fieldStyle, gridColumn: "span 2" }}>
          <span>IMEI, Asset Tag or Serial *</span>
          <textarea
            value={text}
            onChange={(e) => changeText(e.target.value)}
            rows={6}
            placeholder="Scan the QR codes one after another, or paste IMEIs, Asset Tags or Serials, one per line"
            autoComplete="off"
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
          />
          <small className={styles.muted}>One phone per line. Details load automatically from the mobile sheet.</small>
        </label>
      </div>

      <CameraAddBox
        save={cameraAddMobile}
      />

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
                <th style={cellStyle}>IMEI</th>
                <th style={cellStyle}>Asset Tag</th>
                <th style={cellStyle}>Model</th>
                <th style={cellStyle}>Category</th>
                <th style={cellStyle}>Manufacturer</th>
                <th style={cellStyle}>Storage</th>
                <th style={cellStyle}>Cost</th>
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
                    <td style={{ ...cellStyle, fontFamily: "monospace" }}>{row.imei || row.scanned.slice(0, 30)}</td>
                    <td style={cellStyle}>{row.assetTag || "—"}</td>
                    <td style={cellStyle}>{row.model || "—"}</td>
                    <td style={cellStyle}>{row.category || "—"}</td>
                    <td style={cellStyle}>{row.manufacturer || "—"}</td>
                    <td style={cellStyle}>{row.storage || "—"}</td>
                    <td style={cellStyle}>{rupees(row.cost)}</td>
                    <td style={{ ...cellStyle, color: label.color, fontWeight: 600 }}>{label.text}</td>
                    <td style={cellStyle}>
                      <button type="button" onClick={() => removeRow(row.key)} aria-label={`Remove ${row.imei || row.scanned}`} title="Remove from list">
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
            <strong>{ready.length}</strong> mobile{ready.length === 1 ? "" : "s"} will be added to{" "}
            <strong>{homeHubName || "Instawork Robotics Labs"}</strong>. Only rows marked Ready are added.
          </span>
          <button type="button" disabled={busy || !ready.length} onClick={() => void save()}>
            {saving ? "Saving…" : `Add ${ready.length} mobile${ready.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {!homeHubName && (
          <p className={styles.error} style={{ margin: 0 }}>
            No active hub named Instawork Robotics Labs. Add it on the Hubs page first.
          </p>
        )}
        {checking && <p className={styles.muted} style={{ margin: 0 }}>Looking up mobile details…</p>}
        {message && <p className={styles.error} style={{ margin: 0 }}>{message}</p>}
        {result?.error && <p className={styles.error} style={{ margin: 0 }}>{result.error}</p>}
        {result && result.added.length > 0 && (
          <p className={styles.ok} style={{ margin: 0 }}>
            Added {result.added.length} mobile{result.added.length === 1 ? "" : "s"}: {result.added.join(", ")}.
          </p>
        )}
        {result && result.skipped.length > 0 && (
          <p className={styles.error} style={{ margin: 0 }}>
            Skipped {result.skipped.length}: {result.skipped.map((s) => `${s.imei} (${s.reason})`).join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}
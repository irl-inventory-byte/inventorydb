"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import CameraAddBox from "./CameraAddBox";
import { cameraAddSdCard } from "./camera-add";
import styles from "../admin/admin.module.css";
import {
  addItems,
  checkSerials,
  type BulkAddResult,
  type SerialCheck,
} from "./actions";

type Hubs = {
  hub_id: string;
  name: string;
}[];

type Row = SerialCheck & { key: string };

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
};

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  padding: "10px 12px",
};

const cellStyle: CSSProperties = {
  padding: "8px 10px",
  textAlign: "left",
  verticalAlign: "middle",
  whiteSpace: "nowrap",
};

// Display only; the server works out the penalty again before saving.
function penaltyLabel(capacity: string): string {
  if (capacity === "256 GB") return "₹10,000";
  if (capacity === "512 GB") return "₹20,000";
  return "—";
}

function splitSerials(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isReady(row: Row): boolean {
  return row.status === "ready" && !!row.capacity;
}

function checkLabel(row: Row): { text: string; color: string } {
  if (row.status === "exists")
    return { text: "Already in inventory", color: "#8A4B00" };
  if (row.status === "repeated")
    return { text: "Repeated in list", color: "#8A4B00" };
  if (row.status === "notfound")
    return { text: "Not found – use Add an item", color: "#B42318" };
  if (!row.capacity)
    return { text: "No storage in sheet – use Add an item", color: "#B42318" };
  return { text: "Ready", color: "#15803D" };
}

export default function BulkAddForm({
  hubs = [],
}: {
  hubs?: Hubs;
}) {
  const router = useRouter();

  const [homeHub, setHomeHub] = useState("");
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [checking, setChecking] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hubError, setHubError] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<BulkAddResult | null>(null);

  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      requestId.current += 1;
    };
  }, []);

  async function check(value: string) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setWaiting(false);

    const serials = splitSerials(value);
    const current = ++requestId.current;

    if (!serials.length) {
      setRows([]);
      setChecking(false);
      return;
    }

    setChecking(true);
    setMessage("");

    try {
      const found = await checkSerials(serials);
      if (current !== requestId.current) return;

      if ("error" in found) {
        setRows([]);
        setMessage(found.error);
        return;
      }

      setRows(
        found.map((row, index) => ({
          ...row,
          key: `${row.serial}-${index}`,
        }))
      );

      if (serials.length > found.length) {
        setMessage(
          `Only the first ${found.length} serials were checked. Add the rest in another batch.`
        );
      }
    } catch {
      if (current !== requestId.current) return;
      setMessage(
        "Could not load the asset sheet. Try Fetch details again."
      );
    } finally {
      if (current === requestId.current) setChecking(false);
    }
  }

  function changeText(value: string) {
    setText(value);
    setResult(null);

    if (timer.current) clearTimeout(timer.current);
    setWaiting(true);

    // Fetch automatically once typing or scanning pauses.
    timer.current = setTimeout(() => {
      timer.current = null;
      void check(value);
    }, 800);
  }

  function removeRow(key: string) {
    setRows((current) => {
      const next = current.filter((row) => row.key !== key);
      setText(next.map((row) => row.serial).join("\n"));
      return next;
    });
  }

  const readyRows = rows.filter(isReady);
  const counts = {
    exists: rows.filter((r) => r.status === "exists").length,
    notfound: rows.filter((r) => r.status === "notfound").length,
    repeated: rows.filter((r) => r.status === "repeated").length,
    noStorage: rows.filter((r) => r.status === "ready" && !r.capacity).length,
  };
  const hubName = hubs.find((h) => h.hub_id === homeHub)?.name ?? "";
  const busy = checking || saving || waiting;

  async function save() {
    if (!homeHub) {
      setHubError(true);
      return;
    }
    if (!readyRows.length) return;

    setSaving(true);
    setResult(null);
    setMessage("");

    try {
      const outcome = await addItems({
        homeHub,
        rows: readyRows.map((row) => ({
          serial: row.serial,
          prismNo: row.prismNo,
          brand: row.brand,
          model: row.model,
          capacity: row.capacity,
          cardType: row.cardType,
        })),
      });

      setResult(outcome);

      if (outcome.added.length) {
        const added = new Set(outcome.added.map((s) => s.toUpperCase()));
        const left = rows.filter((r) => !added.has(r.serial.toUpperCase()));
        setRows(left);
        setText(left.map((r) => r.serial).join("\n"));
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
        {/* Home hub is mandatory and applies to every item. */}
        <label style={fieldStyle}>
          <span>Home hub *</span>
          <select
            value={homeHub}
            onChange={(event) => {
              setHomeHub(event.target.value);
              setHubError(false);
            }}
            aria-invalid={hubError || undefined}
            style={{
              ...inputStyle,
              borderColor: hubError ? "#B42318" : undefined,
            }}
          >
            <option value="" disabled>
              Select home hub
            </option>
            {hubs.map((hub) => (
              <option key={hub.hub_id} value={hub.hub_id}>
                {hub.name}
              </option>
            ))}
          </select>
          {hubError ? (
            <small style={{ color: "#B42318" }}>
              Choose a home hub before adding items.
            </small>
          ) : (
            <small className={styles.muted}>
              Required. Applies to every item in the list.
            </small>
          )}
        </label>

        <label style={{ ...fieldStyle, gridColumn: "span 2" }}>
          <span>Serial / Asset Tags *</span>
          <textarea
            value={text}
            onChange={(event) => changeText(event.target.value)}
            rows={5}
            placeholder={"Scan or paste serials, one per line"}
            autoComplete="off"
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
          />
          <small className={styles.muted}>
            One per line. Details load automatically when scanning pauses.
          </small>
        </label>
      </div>

      <CameraAddBox
        onOpen={() => {
          if (homeHub) return true;
          setHubError(true);
          return false;
        }}
        save={(code) => cameraAddSdCard(code, homeHub)}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          disabled={checking || !text.trim()}
          onClick={() => void check(text)}
        >
          {checking ? "Fetching…" : "Fetch details"}
        </button>
        {rows.length > 0 && (
          <span className={styles.muted}>
            {rows.length} checked · {readyRows.length} ready
            {counts.noStorage ? ` · ${counts.noStorage} missing storage` : ""}
            {counts.exists ? ` · ${counts.exists} already in inventory` : ""}
            {counts.repeated ? ` · ${counts.repeated} repeated` : ""}
            {counts.notfound ? ` · ${counts.notfound} not found` : ""}
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd" }}>
                <th style={cellStyle}>#</th>
                <th style={cellStyle}>Serial</th>
                <th style={cellStyle}>Prism no.</th>
                <th style={cellStyle}>Brand / Model</th>
                <th style={cellStyle}>Storage</th>
                <th style={cellStyle}>Colour</th>
                <th style={cellStyle}>Date</th>
                <th style={cellStyle}>New / Old</th>
                <th style={cellStyle}>Penalty</th>
                <th style={cellStyle}>Check</th>
                <th style={cellStyle}>
                  <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const label = checkLabel(row);
                return (
                  <tr key={row.key} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={cellStyle}>{index + 1}</td>
                    <td style={{ ...cellStyle, fontFamily: "monospace" }}>{row.serial}</td>
                    <td style={{ ...cellStyle, fontFamily: "monospace" }}>{row.prismNo || "—"}</td>
                    <td style={cellStyle}>{row.model || row.brand || "—"}</td>
                    <td style={cellStyle}>{row.capacity || "—"}</td>
                    <td style={cellStyle}>{row.cardType || "—"}</td>
                    <td style={cellStyle}>{row.date || "—"}</td>
                    <td style={cellStyle}>{row.condition || "—"}</td>
                    <td style={cellStyle}>{penaltyLabel(row.capacity)}</td>
                    <td style={{ ...cellStyle, color: label.color, fontWeight: 600 }}>
                      {label.text}
                    </td>
                    <td style={cellStyle}>
                      <button
                        type="button"
                        onClick={() => removeRow(row.key)}
                        aria-label={`Remove ${row.serial}`}
                        title="Remove from list"
                      >
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
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>
            <strong>{readyRows.length}</strong> item{readyRows.length === 1 ? "" : "s"} will be
            added to <strong>{hubName || "the chosen hub"}</strong>. Only rows marked Ready are
            added.
          </span>
          <button type="button" disabled={busy || !readyRows.length} onClick={() => void save()}>
            {saving
              ? "Saving…"
              : `Add ${readyRows.length} item${readyRows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      )}

      <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {checking && <p className={styles.muted} style={{ margin: 0 }}>Looking up card details…</p>}
        {message && <p className={styles.error} style={{ margin: 0 }}>{message}</p>}
        {result?.error && <p className={styles.error} style={{ margin: 0 }}>{result.error}</p>}
        {result && result.added.length > 0 && (
          <p className={styles.ok} style={{ margin: 0 }}>
            Added {result.added.length} item{result.added.length === 1 ? "" : "s"}
            {hubName ? ` to ${hubName}` : ""}: {result.added.join(", ")}.
          </p>
        )}
        {result && result.skipped.length > 0 && (
          <p className={styles.error} style={{ margin: 0 }}>
            Skipped {result.skipped.length}:{" "}
            {result.skipped.map((s) => `${s.serial} (${s.reason})`).join("; ")}
          </p>
        )}
      </div>
    </div>
  );
}
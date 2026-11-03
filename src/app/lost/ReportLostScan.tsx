"use client";

import { useMemo, useState } from "react";
import { ITEM_TYPE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { classifyScans } from "@/lib/scan";
import { STATUSES, type Status } from "@/lib/schema";
import CameraScanButton, { appendLine, type ScanOutcome } from "../CameraScanButton";
import { reportLostScan } from "./actions";

/**
 * Admin/IM only: scan (or paste) item codes and report them as Lost or Broken right from this page,
 * instead of going to the Inventory page's Correct form. Reuses the same "correct" event under the
 * hood (see lib/lost.ts), so the report shows up exactly like one made there.
 */
export default function ReportLostScan({
  status,
  items,
}: {
  status: Status;
  items: { id: string; status: Status; type?: string }[];
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const label = status === "damaged" ? "broken" : "lost";

  const statuses = useMemo(() => new Map(items.map((i) => [i.id, i.status])), [items]);
  const typeOf = useMemo(() => new Map(items.map((i) => [i.id, i.type ?? "sd_card"])), [items]);
  // Anything not already at the target status can be reported.
  const allowed = useMemo(() => new Set(STATUSES.filter((s) => s !== status)), [status]);
  const results = useMemo(() => classifyScans(text, statuses, allowed), [text, statuses, allowed]);
  const ready = results.filter((r) => r.state === "ok").length;

  function cameraOutcome(code: string): ScanOutcome {
    const r = classifyScans(code, statuses, allowed)[0];
    if (!r || !r.id) return { ok: false, message: "Not found in the inventory" };
    const type = ITEM_TYPE_LABELS[typeOf.get(r.id) ?? "sd_card"];
    if (r.state === "wrong") return { id: r.id, type, ok: false, message: `Already ${label}` };
    return { id: r.id, type, ok: true, message: `Will be marked ${label}` };
  }

  return (
    <details style={{ margin: "4px 0 16px" }}>
      <summary style={{ cursor: "pointer", color: "#1d4ed8", fontWeight: 600 }}>Scan to report {label} ▾</summary>
      <form
        action={reportLostScan}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 8,
          padding: 12,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#f8fafc",
          maxWidth: 480,
        }}
      >
        <input type="hidden" name="status" value={status} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: "0.82rem", color: "#64748b" }}>Scan or paste item codes, one per line</span>
          <CameraScanButton onScan={(code) => { setText((t) => appendLine(t, code)); return cameraOutcome(code); }} />
        </div>
        <textarea
          name="scanned"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Scan items here. Each code on its own line."
          spellCheck={false}
          autoComplete="off"
          style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1" }}
        />
        {results.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2, fontSize: "0.82rem" }}>
            {results.map((r, i) => (
              <li key={`${r.code}-${i}`} style={{ color: r.state === "ok" ? "#166534" : r.state === "duplicate" ? "#64748b" : "#b3261e" }}>
                {r.state === "ok" ? "✓" : r.state === "duplicate" ? "•" : "✕"} <code>{r.id ?? r.code}</code>
                {r.state === "wrong" && ` — already ${STATUS_LABELS[r.status as Status] ?? r.status}`}
                {r.state === "unknown" && " — not found"}
                {r.state === "duplicate" && " — scanned twice, counted once"}
              </li>
            ))}
          </ul>
        )}
        {results.length > 0 && <span style={{ fontSize: "0.8rem", color: "#64748b" }}>{ready} of {results.length} ready</span>}
        <input
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`Note (required) — why ${label}`}
          required
          style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
        />
        <button
          type="submit"
          disabled={ready === 0}
          style={{
            alignSelf: "flex-start",
            fontSize: "0.85rem",
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #1e293b",
            background: ready === 0 ? "#94a3b8" : "#1e293b",
            borderColor: ready === 0 ? "#94a3b8" : "#1e293b",
            color: "#fff",
            cursor: ready === 0 ? "not-allowed" : "pointer",
          }}
        >
          Report {ready > 0 ? ready : ""} {label}
        </button>
      </form>
    </details>
  );
}   
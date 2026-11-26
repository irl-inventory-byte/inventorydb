"use client";

import { useMemo, useState } from "react";
import { retireRigsBulk } from "../../inventory/rig-actions";
import CameraScanButton, { appendLine, type ScanOutcome } from "../../CameraScanButton";

/**
 * Scan or paste several rig codes and declare them all dead at once, with one shared reason.
 * Only a rig listed as eligible below (checked against the server again in retireRigsBulk, since
 * this list can go stale) will actually be retired — anything else scanned is shown as excluded
 * before you submit, same idea as the Lost/Retired pages' scan boxes.
 */
export default function RetireRigsScan({ rigs }: { rigs: { id: string; hub?: string }[] }) {
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const eligible = useMemo(() => new Set(rigs.map((r) => r.id.toUpperCase())), [rigs]);
  const hubOf = useMemo(() => new Map(rigs.map((r) => [r.id.toUpperCase(), r.hub])), [rigs]);

  type Row = { code: string; state: "ok" | "duplicate" | "not_eligible" };
  const results = useMemo<Row[]>(() => {
    const seen = new Set<string>();
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((code): Row => {
        const key = code.toUpperCase();
        if (seen.has(key)) return { code, state: "duplicate" };
        seen.add(key);
        return { code, state: eligible.has(key) ? "ok" : "not_eligible" };
      });
  }, [text, eligible]);

  const unique = results.filter((r) => r.state === "ok").length;
  const duplicate = results.filter((r) => r.state === "duplicate").length;
  const notEligible = results.filter((r) => r.state === "not_eligible").length;

  function cameraOutcome(code: string): ScanOutcome {
    const key = code.toUpperCase();
    if (!eligible.has(key)) return { ok: false, message: "Not eligible to retire (already retired, or not found)" };
    return { id: code, ok: true, message: `Will be retired${hubOf.get(key) ? ` · ${hubOf.get(key)}` : ""}` };
  }

  const canSubmit = unique > 0 && reason.trim().length > 0 && confirmed;

  return (
    <form
      action={retireRigsBulk}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        margin: "4px 0 16px",
        padding: 14,
        border: "1px solid #cbd5e1",
        borderRadius: 10,
        background: "#f8fafc",
        maxWidth: 560,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: "0.82rem", color: "#64748b" }}>Scan or paste rig codes, one per line</span>
        <CameraScanButton onScan={(code) => { setText((t) => appendLine(t, code)); return cameraOutcome(code); }} />
      </div>
      <textarea
        name="scanned"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Scan rigs here. Each code on its own line."
        spellCheck={false}
        autoComplete="off"
        style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1" }}
      />
      {results.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2, fontSize: "0.82rem" }}>
          {results.map((r, i) => (
            <li key={`${r.code}-${i}`} style={{ color: r.state === "ok" ? "#166534" : r.state === "duplicate" ? "#64748b" : "#b3261e" }}>
              {r.state === "ok" ? "✓" : r.state === "duplicate" ? "•" : "✕"} <code>{r.code}</code>
              {r.state === "not_eligible" && " — not eligible (already retired, not a rig, or not found)"}
              {r.state === "duplicate" && " — scanned twice, counted once"}
            </li>
          ))}
        </ul>
      )}
      {results.length > 0 && (
        <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
          {unique} unique · {duplicate} duplicate · {notEligible} not eligible
        </span>
      )}
      <input
        name="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required) — why these rigs are dead"
        required
        style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
      />
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.82rem", color: "#334155" }}>
        <input
          type="checkbox"
          name="confirm"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I confirm these rigs are dead and beyond repair.
      </label>
      <button
        type="submit"
        disabled={!canSubmit}
        style={{
          alignSelf: "flex-start",
          fontSize: "0.85rem",
          padding: "6px 14px",
          borderRadius: 6,
          border: "1px solid #1e293b",
          background: canSubmit ? "#1e293b" : "#94a3b8",
          borderColor: canSubmit ? "#1e293b" : "#94a3b8",
          color: "#fff",
          cursor: canSubmit ? "pointer" : "not-allowed",
        }}
      >
        Declare dead {unique > 0 ? unique : ""}
      </button>
    </form>
  );
}
"use client";

import { useMemo, useState } from "react";
import { ITEM_TYPE_LABELS, ROLE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { classifyScans } from "@/lib/scan";
import { ROLES, STATUSES, type Status } from "@/lib/schema";
import CameraScanButton, { appendLine, type ScanOutcome } from "../CameraScanButton";
import MultiSelect from "../inventory/MultiSelect";
import { reportLostScan } from "./actions";

/**
 * Admin/IM only: scan (or paste) item codes and report them as Lost or Broken right from this page,
 * instead of going to the Inventory page's Correct form. Reuses the same "correct" event under the
 * hood (see lib/lost.ts), so the report shows up exactly like one made there.
 */
export default function ReportLostScan({
  status,
  items,
  hubs,
  people,
}: {
  status: Status;
  items: { id: string; status: Status; type?: string }[];
  hubs: { id: string; name: string; city: string }[];
  people: { id: string; name: string; role: string }[];
}) {
  const [personRole, setPersonRole] = useState("");
  const peopleOptions = useMemo(
    () =>
      people
        .filter((p) => !personRole || p.role === personRole)
        .map((p) => ({ value: p.id, label: p.name })),
    [people, personRole],
  );
  // Cities in display order, each with its hubs (a city may have more than one hub).
  const cities = useMemo(() => {
    const byCity = new Map<string, { id: string; name: string }[]>();
    for (const h of hubs) {
      if (!byCity.has(h.city)) byCity.set(h.city, []);
      byCity.get(h.city)!.push({ id: h.id, name: h.name });
    }
    return [...byCity.entries()];
  }, [hubs]);
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
          maxWidth: 560,
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
          placeholder={`Reason (required) — why ${label}`}
          required
          style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem" }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", color: "#64748b" }}>
            Date {label === "lost" ? "lost" : "broken"}
            <input
              type="date"
              name="occurredAt"
              max={new Date().toISOString().slice(0, 10)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem", background: "#fff" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", color: "#64748b" }}>
            City (where it happened)
            <select name="hub" defaultValue="" style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem", background: "#fff" }}>
              <option value="">Keep current hub</option>
              {cities.map(([city, cityHubs]) => (
                <optgroup key={city} label={city}>
                  {cityHubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", color: "#64748b" }}>
            Amount (₹)
            <input
              type="number"
              name="amount"
              min={0}
              placeholder="Item cost"
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem", background: "#fff" }}
            />
          </label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", color: "#64748b" }}>
            Role (who had it)
            <select
              value={personRole}
              onChange={(e) => setPersonRole(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem", background: "#fff" }}
            >
              <option value="">Any role</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", color: "#64748b" }}>
            Person(s) who had it
            <MultiSelect name="personIds" label="Person" allLabel="None chosen" options={peopleOptions} selected={[]} searchable />
          </label>
        </div>
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
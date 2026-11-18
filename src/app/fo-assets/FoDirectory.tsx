"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface DirectoryRow {
  id: string;
  name: string;
  mobile: string;
  roleLabel: string;
  hub: string;
  city: string;
  total: number;
  breakdown: string;
}

/**
 * The full FO/IFO list with mobile numbers and current asset totals, all loaded at once — for
 * "give me everything, I'll filter it myself" rather than searching one person at a time. The text
 * box filters instantly, client-side, against name, mobile, role, hub and city; nothing is re-fetched.
 * Clicking a row goes to the same single-FO detail view the search form above also opens (?fo=id).
 */
export default function FoDirectory({ rows, selectedId }: { rows: DirectoryRow[]; selectedId: string }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(t) ||
        r.mobile.includes(t) ||
        r.roleLabel.toLowerCase().includes(t) ||
        r.hub.toLowerCase().includes(t) ||
        r.city.includes(t) ||
        r.breakdown.toLowerCase().includes(t),
    );
  }, [rows, q]);

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name, mobile, role, city or hub…"
          aria-label="Filter the FO/IFO directory"
          style={{ minWidth: 280 }}
        />
        <span style={{ fontSize: 13, color: "var(--muted, #64748b)" }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div role="region" aria-label="FO/IFO directory" tabIndex={0} style={{ width: "100%", maxWidth: "100%", overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left", padding: "6px 16px 6px 0" }}>Name</th>
              <th scope="col" style={{ textAlign: "left", padding: "6px 16px 6px 0" }}>Mobile</th>
              <th scope="col" style={{ textAlign: "left", padding: "6px 16px 6px 0" }}>Role</th>
              <th scope="col" style={{ textAlign: "left", padding: "6px 16px 6px 0" }}>Hub</th>
              <th scope="col" style={{ textAlign: "right", padding: "6px 16px 6px 0" }}>Total</th>
              <th scope="col" style={{ textAlign: "left", padding: "6px 0" }}>Breakdown</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} style={r.id === selectedId ? { outline: "2px solid #2563eb" } : undefined}>
                <td style={{ padding: "6px 16px 6px 0" }}>
                  <Link href={`/fo-assets?fo=${encodeURIComponent(r.id)}`}>{r.name}</Link>
                </td>
                <td style={{ padding: "6px 16px 6px 0" }}>{r.mobile || "—"}</td>
                <td style={{ padding: "6px 16px 6px 0" }}>{r.roleLabel}</td>
                <td style={{ padding: "6px 16px 6px 0" }}>{r.hub}</td>
                <td style={{ textAlign: "right", padding: "6px 16px 6px 0" }}>{r.total}</td>
                <td style={{ padding: "6px 0" }}>{r.breakdown || "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 16 }}>
                  No match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
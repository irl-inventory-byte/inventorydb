"use client";

import { useMemo, useState } from "react";

export interface LoginLocationRow {
  id: string;
  when: string; // already formatted (formatIst)
  email: string;
  role: string;
  address: string;
  mapUrl: string;
}

/**
 * Instant client-side text filter over the login-locations list, same pattern as FoDirectory.tsx —
 * everything is loaded up front, filtering never re-fetches.
 */
export default function LoginLocationsTable({ rows }: { rows: LoginLocationRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
      (r) =>
        r.email.toLowerCase().includes(t) ||
        r.role.toLowerCase().includes(t) ||
        r.address.toLowerCase().includes(t),
    );
  }, [rows, q]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0 16px" }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name/email, role or city…"
          aria-label="Filter login locations"
          style={{ minWidth: 280, padding: "7px 10px" }}
        />
        <span style={{ fontSize: 13, color: "var(--muted, #64748b)" }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left", padding: "8px 16px 8px 0" }}>When</th>
              <th scope="col" style={{ textAlign: "left", padding: "8px 16px 8px 0" }}>Email</th>
              <th scope="col" style={{ textAlign: "left", padding: "8px 16px 8px 0" }}>Role</th>
              <th scope="col" style={{ textAlign: "left", padding: "8px 16px 8px 0" }}>Address</th>
              <th scope="col" style={{ textAlign: "left", padding: "8px 0" }}>Map</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 16, textAlign: "center", color: "var(--muted, #64748b)" }}>
                  No matching logins.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td style={{ padding: "8px 16px 8px 0", whiteSpace: "nowrap" }}>{r.when} IST</td>
                  <td style={{ padding: "8px 16px 8px 0" }}>{r.email}</td>
                  <td style={{ padding: "8px 16px 8px 0" }}>{r.role || "—"}</td>
                  <td style={{ padding: "8px 16px 8px 0" }}>{r.address || "—"}</td>
                  <td style={{ padding: "8px 0" }}>
                    {r.mapUrl ? (
                      <a href={r.mapUrl} target="_blank" rel="noopener noreferrer">
                        View
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
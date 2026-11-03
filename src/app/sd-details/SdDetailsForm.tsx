import type { CSSProperties } from "react";
import type { SdCardDuration } from "@/lib/schema";
import { formatIst } from "@/lib/time";

/**
 * Shared form for "SD Card Duration Hour" details — the same fields as the IM and Rig team Google
 * Forms, now saved to our own database (sd_card_durations tab) and also forwarded to that Google
 * Script form as a best-effort copy (see actions.ts). `memberLabel`/`memberOptions` is the one field
 * that differs between the two forms: "IM" (a list of IMs) on the IM page, "Rig Team Name" (a list of
 * rig/productivity team members) on the Rig page.
 */
export default function SdDetailsForm({
  team,
  action,
  memberLabel,
  memberOptions,
  foIfoOptions,
  cities,
  saved,
  error,
  recent,
}: {
  team: "im" | "rig";
  action: (formData: FormData) => void;
  memberLabel: string;
  memberOptions: { id: string; name: string }[];
  foIfoOptions: { id: string; name: string }[];
  cities: [string, { id: string; name: string }[]][];
  saved: boolean;
  error: string;
  recent: SdCardDuration[];
}) {
  const field: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: "0.78rem", color: "#334155" };
  const input: CSSProperties = { padding: "7px 9px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.88rem", background: "#fff" };

  return (
    <>
      {error && (
        <p style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: "8px 12px" }}>{error}</p>
      )}
      {saved && (
        <p style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: 8, padding: "8px 12px" }}>Saved.</p>
      )}

      <form
        action={action}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
          padding: 14,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#f8fafc",
          maxWidth: 760,
        }}
      >
        <input type="hidden" name="team" value={team} />

        <label style={field}>
          SD card date *
          <input type="date" name="card_date" required max={new Date().toISOString().slice(0, 10)} style={input} />
        </label>

        <label style={field}>
          {memberLabel} *
          <select name="team_member" required defaultValue="" style={input}>
            <option value="" disabled>
              Select {memberLabel}
            </option>
            {memberOptions.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label style={field}>
          FO / IFO
          <select name="fo_ifo" defaultValue="" style={input}>
            <option value="">Select FO / IFO</option>
            {foIfoOptions.map((p) => (
              <option key={p.id} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label style={field}>
          IC name *
          <input type="text" name="ic_name" required placeholder="IC name" style={input} />
        </label>

        <label style={field}>
          City *
          <select name="city" required defaultValue="" style={input}>
            <option value="" disabled>
              Select city
            </option>
            {cities.map(([city]) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>

        <label style={field}>
          IC-Number (must start with IC-) *
          <input type="text" name="ic_number" required pattern="IC-.*" title="Must start with IC-" placeholder="IC-123" style={input} />
        </label>

        <label style={field}>
          SD card serial number / asset tag *
          <input type="text" name="serial" required placeholder="Serial or asset tag" style={input} />
        </label>

        <label style={field}>
          Duration (HH:MM:SS) *
          <input type="text" name="duration" required pattern="\d{1,2}:\d{2}:\d{2}" placeholder="HH:MM:SS (e.g. 01:30:45)" style={input} />
        </label>

        <label style={field}>
          No. of raw clips *
          <input type="number" name="raw_clips" required min={0} placeholder="e.g. 25" style={input} />
        </label>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            type="submit"
            style={{
              fontSize: "0.88rem",
              fontWeight: 600,
              padding: "8px 18px",
              borderRadius: 6,
              border: "1px solid #1e293b",
              background: "#1e293b",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Submit
          </button>
        </div>
      </form>

      {recent.length > 0 && (
        <div role="region" aria-label="Recent entries" tabIndex={0} style={{ overflowX: "auto", marginTop: 20 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #cbd5e1" }}>
                <th style={{ padding: "6px 8px" }}>Date</th>
                <th style={{ padding: "6px 8px" }}>{memberLabel}</th>
                <th style={{ padding: "6px 8px" }}>FO / IFO</th>
                <th style={{ padding: "6px 8px" }}>IC</th>
                <th style={{ padding: "6px 8px" }}>City</th>
                <th style={{ padding: "6px 8px" }}>Serial</th>
                <th style={{ padding: "6px 8px" }}>Duration</th>
                <th style={{ padding: "6px 8px" }}>Clips</th>
                <th style={{ padding: "6px 8px" }}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.record_id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "6px 8px" }}>{r.card_date}</td>
                  <td style={{ padding: "6px 8px" }}>{r.team_member}</td>
                  <td style={{ padding: "6px 8px" }}>{r.fo_ifo || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {r.ic_name} {r.ic_number && `(${r.ic_number})`}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{r.city}</td>
                  <td style={{ padding: "6px 8px" }}>{r.serial}</td>
                  <td style={{ padding: "6px 8px" }}>{r.duration}</td>
                  <td style={{ padding: "6px 8px" }}>{r.raw_clips}</td>
                  <td style={{ padding: "6px 8px", color: "#64748b" }}>{r.recorded_at ? formatIst(r.recorded_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
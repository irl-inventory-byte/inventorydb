import type { CSSProperties } from "react";
import type { SdCardDuration } from "@/lib/schema";
import { formatIst } from "@/lib/time";
import SdDetailsFields from "./SdDetailsFields";

// Hard-coded IC name list (given by the user directly — no admin page to manage this yet). Also used
// by the filter bar below (the add-entry form itself now lives in SdDetailsFields.tsx).
const IC_NAMES = [
  "Aditya", "Anshitha", "Bhavana", "Hari Prasad M S", "Hemanth", "Kavya", "Kusuma H",
  "MALIAKA", "Mohit", "NAVEEN", "Niharika", "Prajakta", "Priyanshu", "Sohan", "Spoorthi",
  "Sumit", "Tejash", "Yashaswini", "Ritika", "Sujay", "Arush", "Nishanth", "Devesh",
  "Krishen", "Abhijnan", "Kshithi", "Shashwath", "Suhaib", "Kavin", "Smita", "Brunda",
  "vinay", "Nandadeep", "Nikshitha", "Nancy", "Franklin", "Akshay", "Guru",
];

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
  defaultMember,
  filters,
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
  /** The logged-in person's own name, when it's in memberOptions — pre-selects the dropdown so they
   * don't have to pick themselves every time. "" if not found (e.g. an admin filling this in for someone else). */
  defaultMember?: string;
  /** Current values of the "recent entries" filter bar (from page.tsx's searchParams) and whether
   * any of them are set, so the table title / clear link can reflect that. Optional so this component
   * still compiles if a caller doesn't pass it, but both IM and Rig pages should. */
  filters?: {
    from: string; // YYYY-MM-DD, inclusive
    to: string; // YYYY-MM-DD, inclusive
    member: string; // team_member, exact match (from the same name list as the add form)
    foIfo: string; // fo_ifo, exact match
    city: string; // exact match
    ic: string; // ic_name, exact match
  };
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

      <SdDetailsFields
        team={team}
        action={action}
        memberLabel={memberLabel}
        memberOptions={memberOptions}
        foIfoOptions={foIfoOptions}
        cities={cities}
        defaultMember={defaultMember}
      />

      {filters && (
        <form
          method="get"
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: 10,
            marginTop: 22,
            padding: "10px 12px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            background: "#f8fafc",
          }}
        >
          <label style={field}>
            From
            <input type="date" name="from" defaultValue={filters.from} max={filters.to || undefined} style={input} />
          </label>
          <label style={field}>
            To
            <input type="date" name="to" defaultValue={filters.to} min={filters.from || undefined} style={input} />
          </label>
          <label style={field}>
            {memberLabel}
            <input
              list="filter-member-options"
              name="member"
              defaultValue={filters.member}
              placeholder={`All ${memberLabel.toLowerCase()}s`}
              autoComplete="off"
              style={input}
            />
            <datalist id="filter-member-options">
              {memberOptions.map((m) => (
                <option key={m.id} value={m.name} />
              ))}
            </datalist>
          </label>
          <label style={field}>
            FO / IFO
            <input
              list="filter-foifo-options"
              name="foIfo"
              defaultValue={filters.foIfo}
              placeholder="All FO / IFO"
              autoComplete="off"
              style={input}
            />
            <datalist id="filter-foifo-options">
              {foIfoOptions.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </label>
          <label style={field}>
            City
            <select name="city" defaultValue={filters.city} style={input}>
              <option value="">All cities</option>
              {cities.map(([city]) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
          </label>
          <label style={field}>
            IC name
            <input
              list="filter-ic-name-options"
              name="ic"
              defaultValue={filters.ic}
              placeholder="All IC names"
              autoComplete="off"
              style={input}
            />
            <datalist id="filter-ic-name-options">
              {IC_NAMES.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </label>
          <button
            type="submit"
            style={{
              fontSize: "0.82rem",
              fontWeight: 600,
              padding: "7px 14px",
              borderRadius: 6,
              border: "1px solid #1e293b",
              background: "#1e293b",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Filter
          </button>
          {(filters.from || filters.to || filters.member || filters.foIfo || filters.city || filters.ic) && (
            <a href="?" style={{ fontSize: "0.82rem", color: "#64748b" }}>
              Clear filters
            </a>
          )}
        </form>
      )}

      {recent.length > 0 ? (
        <div role="region" aria-label="Recent entries" tabIndex={0} style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #cbd5e1" }}>
                <th style={{ padding: "6px 8px" }}>Date</th>
                {team === "rig" && <th style={{ padding: "6px 8px" }}>Team</th>}
                <th style={{ padding: "6px 8px" }}>{memberLabel}</th>
                <th style={{ padding: "6px 8px" }}>FO / IFO</th>
                <th style={{ padding: "6px 8px" }}>IC</th>
                <th style={{ padding: "6px 8px" }}>City</th>
                <th style={{ padding: "6px 8px" }}>Serial</th>
                <th style={{ padding: "6px 8px" }}>Duration</th>
                {team === "rig" && <th style={{ padding: "6px 8px" }}>Failed</th>}
                <th style={{ padding: "6px 8px" }}>Clips</th>
                <th style={{ padding: "6px 8px" }}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.record_id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "6px 8px" }}>{r.card_date}</td>
                  {team === "rig" && (
                    <td style={{ padding: "6px 8px" }}>{r.sub_team === "productivity" ? "Productivity team" : "Rig team"}</td>
                  )}
                  <td style={{ padding: "6px 8px" }}>{r.team_member}</td>
                  <td style={{ padding: "6px 8px" }}>{r.fo_ifo || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {r.ic_name} {r.ic_number && `(${r.ic_number})`}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{r.city}</td>
                  <td style={{ padding: "6px 8px" }}>{r.serial}</td>
                  <td style={{ padding: "6px 8px" }}>{r.duration}</td>
                  {team === "rig" && <td style={{ padding: "6px 8px" }}>{r.failed_hours || "—"}</td>}
                  <td style={{ padding: "6px 8px" }}>{r.raw_clips}</td>
                  <td style={{ padding: "6px 8px", color: "#64748b" }}>{r.recorded_at ? formatIst(r.recorded_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        filters && (
          <p style={{ color: "#64748b", marginTop: 16, fontSize: "0.85rem" }}>No entries match these filters.</p>
        )
      )}
    </>
  );
}
import Link from "next/link";
import type { AckBucket } from "@/lib/ack-stats";

/**
 * Handover-receipt acknowledgments (FO / IFO recipients only — see lib/ack-stats.ts), as a simple
 * stacked bar per bucket: Yes (green) / No (red) / Pending (grey). `by` toggles the grouping
 * (city or role) via a plain link, same pattern as the rest of the dashboard's filters.
 */
export default function AckChart({
  by,
  buckets,
  href,
  ackFrom,
  ackTo,
  hidden,
  clearHref,
  role,
  roleHref,
  cities,
  city,
  avgResponse,
}: {
  by: "city" | "role" | "day" | "hour";
  buckets: AckBucket[];
  href: (by: "city" | "role" | "day" | "hour") => string;
  ackFrom: string; // YYYY-MM-DD, "" = no lower bound
  ackTo: string; // YYYY-MM-DD, "" = no upper bound
  hidden: Record<string, string>; // other dashboard filters + the current grouping, carried by the date form
  clearHref: string; // same page, with the date range removed
  role: "" | "fo" | "ifo"; // "" = both
  roleHref: (role: "" | "fo" | "ifo") => string;
  cities: string[]; // every city with at least one FO/IFO, for the city filter dropdown
  city: string; // "" = all cities
  avgResponse: string; // e.g. "2h 15m", already formatted — "" when nothing answered yet to average
}) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const totals = buckets.reduce(
    (t, b) => ({ yes: t.yes + b.yes, no: t.no + b.no, pending: t.pending + b.pending }),
    { yes: 0, no: 0, pending: 0 },
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Acknowledgements</h2>
        <nav aria-label="Group by" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["city", "role", "day", "hour"] as const).map((v) => (
            <Link
              key={v}
              href={href(v)}
              aria-current={by === v ? "true" : undefined}
              style={{
                padding: "4px 12px",
                borderRadius: 999,
                border: "1px solid #cbd5e1",
                background: by === v ? "#1e293b" : "#fff",
                color: by === v ? "#fff" : "#334155",
                textDecoration: "none",
                fontSize: "0.82rem",
                fontWeight: by === v ? 700 : 500,
              }}
            >
              By {v === "city" ? "city" : v === "role" ? "FO / IFO" : v === "day" ? "day" : "hour"}
            </Link>
          ))}
        </nav>
      </div>

      <p style={{ margin: "0 0 10px", fontSize: "0.82rem", color: "#64748b" }}>
        Handover receipts sent to FOs and IFOs: whether they acknowledged receiving the items.{" "}
        <span style={{ color: "#166534" }}>■</span> Yes{" "}
        <span style={{ color: "#b3261e" }}>■</span> No{" "}
        <span style={{ color: "#94a3b8" }}>■</span> Pending
      </p>

      <nav aria-label="Filter by recipient" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(["", "fo", "ifo"] as const).map((v) => (
          <Link
            key={v || "all"}
            href={roleHref(v)}
            aria-current={role === v ? "true" : undefined}
            style={{
              padding: "4px 12px",
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: role === v ? "#1d4ed8" : "#fff",
              color: role === v ? "#fff" : "#334155",
              textDecoration: "none",
              fontSize: "0.78rem",
              fontWeight: role === v ? 700 : 500,
            }}
          >
            {v === "" ? "All" : v.toUpperCase()}
          </Link>
        ))}
      </nav>

      <form
        method="get"
        action="/dashboard#acknowledgements"
        style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap", marginBottom: 14, padding: "8px 10px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8 }}
      >
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {cities.length > 0 && (
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.72rem", color: "#64748b" }}>
            City
            <select name="ackCity" defaultValue={city} style={{ fontSize: "0.8rem", padding: "4px 6px", borderRadius: 6, border: "1px solid #cbd5e1" }}>
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.72rem", color: "#64748b" }}>
          From
          <input type="date" name="ackFrom" defaultValue={ackFrom} style={{ fontSize: "0.8rem", padding: "4px 6px", borderRadius: 6, border: "1px solid #cbd5e1" }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.72rem", color: "#64748b" }}>
          To
          <input type="date" name="ackTo" defaultValue={ackTo} style={{ fontSize: "0.8rem", padding: "4px 6px", borderRadius: 6, border: "1px solid #cbd5e1" }} />
        </label>
        <button
          type="submit"
          style={{ fontSize: "0.78rem", padding: "5px 12px", borderRadius: 6, border: "1px solid #1e293b", background: "#1e293b", color: "#fff", cursor: "pointer" }}
        >
          Apply
        </button>
        {(ackFrom || ackTo || city) && (
          <Link href={clearHref} style={{ fontSize: "0.78rem", color: "#64748b", alignSelf: "center" }}>
            Clear filters
          </Link>
        )}
      </form>

      {buckets.length === 0 ? (
        <p style={{ color: "#64748b", fontSize: "0.88rem" }}>No acknowledgments recorded yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {buckets.map((b) => (
            <div key={b.label} style={{ display: "grid", gridTemplateColumns: "110px 1fr 90px", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "0.85rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {b.label}
              </span>
              <div style={{ display: "flex", height: 16, borderRadius: 4, overflow: "hidden", background: "#eef2f6", width: `${Math.max(10, (b.total / max) * 100)}%` }}>
                {b.yes > 0 && <span style={{ flex: b.yes, background: "#16a34a" }} title={`Yes: ${b.yes}`} />}
                {b.no > 0 && <span style={{ flex: b.no, background: "#dc2626" }} title={`No: ${b.no}`} />}
                {b.pending > 0 && <span style={{ flex: b.pending, background: "#cbd5e1" }} title={`Pending: ${b.pending}`} />}
              </div>
              <span style={{ fontSize: "0.78rem", color: "#64748b", textAlign: "right" }}>
                {b.yes}/{b.total} acked
              </span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: "0.8rem", color: "#334155", borderTop: "1px solid #e2e8f0", paddingTop: 8 }}>
            <span>
              <strong>{totals.yes}</strong> acknowledged
            </span>
            <span>
              <strong>{totals.no}</strong> declined
            </span>
            <span>
              <strong>{totals.pending}</strong> pending
            </span>
            {avgResponse && (
              <span>
                <strong>{avgResponse}</strong> average time to acknowledge
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
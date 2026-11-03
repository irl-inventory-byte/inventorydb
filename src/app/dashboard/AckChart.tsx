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
}: {
  by: "city" | "role";
  buckets: AckBucket[];
  href: (by: "city" | "role") => string;
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
        <nav aria-label="Group by" style={{ display: "flex", gap: 6 }}>
          {(["city", "role"] as const).map((v) => (
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
              By {v === "city" ? "city" : "FO / IFO"}
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
          </div>
        </div>
      )}
    </>
  );
}
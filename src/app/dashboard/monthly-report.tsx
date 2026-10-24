import Link from "next/link";
import type { CSSProperties } from "react";
import { REPORT_TYPE_LABEL, monthLabel, type MonthlyReport } from "@/lib/monthly-report";
import styles from "./dashboard.module.css";

const TH: CSSProperties = { position: "sticky", top: 0, background: "#1e293b", color: "#fff", textAlign: "left" };

/**
 * Dashboard → Monthly report: choose a month, see the numbers for every item type, and download the
 * full report as an Excel file (summary, movements, by person, by hub, every item, rig QC).
 */
export function MonthlyReportCard({
  report,
  months,
  keep,
}: {
  report: MonthlyReport;
  months: string[];
  keep: Record<string, string>;
}) {
  const download = `/api/monthly-report?${new URLSearchParams({ month: report.month })}`;
  return (
    <section className={styles.card} id="monthly-report" aria-label="Monthly report" style={{ minWidth: 0, scrollMarginTop: 16 }}>
      <div className={styles.sectionHead}>
        <h2>Monthly report · {report.label}</h2>
      </div>
      <p className={styles.muted}>
        What was added, sent and received in the month, and where every item is now. SD cards, rigs and mobiles
        together. The Excel file has the full detail: every movement, by person, by hub and every item.
      </p>

      <form method="get" action="/dashboard#monthly-report" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", margin: "6px 0 12px" }}>
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span>Month</span>
          <select
            name="rmonth"
            defaultValue={report.month}
            style={{ padding: "8px 12px", border: "1px solid #c9c9c9", borderRadius: 8, background: "#fff", font: "inherit" }}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #1e293b", background: "#fff", color: "#1e293b", font: "inherit", fontWeight: 600, cursor: "pointer" }}
        >
          Show
        </button>
        <a
          href={download}
          download
          style={{ padding: "8px 16px", borderRadius: 8, background: "#15803d", color: "#fff", textDecoration: "none", fontWeight: 600 }}
        >
          ⬇ Download Excel
        </a>
      </form>

      <div className={styles.tableScroll} role="region" aria-label="Monthly report — table" tabIndex={0} style={{ overflowX: "auto" }}>
        <table className={styles.table} style={{ width: "100%", minWidth: 560, borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th scope="col" style={TH}>
                {report.label}
              </th>
              {report.types.map((t) => (
                <th key={t} scope="col" style={{ ...TH, textAlign: "right" }}>
                  {REPORT_TYPE_LABEL[t]}
                </th>
              ))}
              <th scope="col" style={{ ...TH, textAlign: "right" }}>
                All
              </th>
            </tr>
          </thead>
          <tbody>
            {report.summary.map((r, n) => (
              <tr key={r.label} style={n === 5 ? { borderTop: "2px solid #e5e7eb" } : undefined}>
                <td style={n === 5 ? { borderTop: "2px solid #cbd5e1" } : undefined}>{r.label}</td>
                {report.types.map((t) => (
                  <td key={t} className={styles.num} style={n === 5 ? { borderTop: "2px solid #cbd5e1" } : undefined}>
                    {r.values[t].toLocaleString("en-IN")}
                  </td>
                ))}
                <td className={styles.num} style={{ fontWeight: 700, ...(n === 5 ? { borderTop: "2px solid #cbd5e1" } : {}) }}>
                  {r.values.all.toLocaleString("en-IN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} style={{ marginTop: 8 }}>
        {report.monthEvents.length.toLocaleString("en-IN")} movements in {report.label}.{" "}
        <Link href={download} className={styles.link}>
          Download the Excel file
        </Link>{" "}
        for every movement and every item.
      </p>
    </section>
  );
}
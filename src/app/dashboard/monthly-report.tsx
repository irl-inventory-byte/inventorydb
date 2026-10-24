import Link from "next/link";
import type { CSSProperties } from "react";
import { REPORT_TYPE_LABEL, type MonthlyReport } from "@/lib/monthly-report";
import styles from "./dashboard.module.css";

const TH: CSSProperties = { position: "sticky", top: 0, background: "#1e293b", color: "#fff", textAlign: "left" };

const control: CSSProperties = { padding: "8px 10px", border: "1px solid #c9c9c9", borderRadius: 8, background: "#fff", font: "inherit" };
const field: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.85rem", color: "#475569" };

/**
 * Dashboard → Report: choose the dates and, if wanted, one person, one city and one item type. See the
 * numbers, and download the full report as an Excel file (summary, movements, by person, by hub, every
 * item, rig QC).
 */
export function MonthlyReportCard({
  report,
  people,
  cities,
  types,
  keep,
}: {
  report: MonthlyReport;
  people: { id: string; label: string }[];
  cities: string[];
  types: string[];
  keep: Record<string, string>;
}) {
  const f = report.filter;
  const q: Record<string, string> = { from: f.from, to: f.to };
  if (f.person) q.person = f.person;
  if (f.city) q.city = f.city;
  if (f.type) q.type = f.type;
  const download = `/api/monthly-report?${new URLSearchParams(q)}`;
  const filtered = !!(f.person || f.city || f.type);
  return (
    <section className={styles.card} id="monthly-report" aria-label="Monthly report" style={{ minWidth: 0, scrollMarginTop: 16 }}>
      <div className={styles.sectionHead}>
        <h2>
          Report · {report.label}
          {report.filterText && <span style={{ fontWeight: 500, color: "#475569" }}> · {report.filterText}</span>}
        </h2>
      </div>
      <p className={styles.muted}>
        What was added, sent and received between the two dates, and where the items are now. Choose a person,
        a city or an item type to narrow it, or leave them on All. The Excel file has the full detail: every
        movement, by person, by hub and every item.
      </p>

      <form method="get" action="/dashboard#monthly-report" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", margin: "6px 0 12px" }}>
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label style={field}>
          Person
          <select name="rperson" defaultValue={f.person} style={{ ...control, maxWidth: 240 }}>
            <option value="">All people</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label style={field}>
          City
          <select name="rcity" defaultValue={f.city} style={control}>
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={field}>
          Items
          <select name="rtype" defaultValue={f.type} style={control}>
            <option value="">All items</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {REPORT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label style={field}>
          From
          <input type="date" name="rfrom" defaultValue={f.from} style={control} />
        </label>
        <label style={field}>
          To
          <input type="date" name="rto" defaultValue={f.to} style={control} />
        </label>
        <button
          type="submit"
          style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #1e293b", background: "#fff", color: "#1e293b", font: "inherit", fontWeight: 600, cursor: "pointer" }}
        >
          Show
        </button>
        {/* Downloads with the filters as they are in the form now (no need to press Show first). */}
        <button
          type="submit"
          formAction="/api/monthly-report"
          style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "#15803d", color: "#fff", font: "inherit", fontWeight: 600, cursor: "pointer" }}
        >
          ⬇ Download Excel
        </button>
        {filtered && (
          <Link href={`/dashboard?${new URLSearchParams({ ...keep, rfrom: f.from, rto: f.to })}#monthly-report`} className={styles.link} style={{ alignSelf: "center" }}>
            Clear filters
          </Link>
        )}
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
        {report.monthEvents.length.toLocaleString("en-IN")} movements in {report.label}
        {report.filterText ? ` (${report.filterText})` : ""}.{" "}
        <Link href={download} className={styles.link}>
          Download the Excel file
        </Link>{" "}
        for every movement and every item.
      </p>
    </section>
  );
}
import Link from "next/link";
import type { ActivityDay } from "@/lib/dashboard";
import styles from "./dashboard.module.css";

export const n = (v: number) => v.toLocaleString("en-IN");
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export interface BarRow {
  key: string;
  label: string;
  value: number;
  href: string;
  tip: string;
}

/** One series, one color: bars show magnitude, the value sits at the tip. Each row links to the filtered list. */
export function BarList({ rows }: { rows: BarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={styles.bars}>
      {rows.map((r) => (
        <Link key={r.key} href={r.href} className={`${styles.barRow} ${styles.tip}`} data-tip={r.tip}>
          <span className={styles.barLabel}>{r.label}</span>
          <span className={styles.barTrack}>
            <span className={styles.bar} style={{ width: `${(r.value / max) * 82}%` }} />
            <span className={styles.barValue}>{n(r.value)}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

// Round a maximum up to 1, 2, 5 x 10^n so the axis ticks are clean numbers.
function niceMax(v: number) {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].map((m) => m * mag).find((c) => c >= v) ?? v);
}

const SERIES = [
  { key: "sent", label: "Sent", color: "var(--series-1)" },
  { key: "received", label: "Received", color: "var(--series-2)" },
  { key: "corrected", label: "Corrected", color: "var(--series-3)" },
] as const;

const PLOT_HEIGHT = 170;

/**
 * Items moved per day: stacked columns, 2px gaps, one shared axis, tooltip per day.
 * The day's total sits on top of each column (a data label). `unit` names what is counted, e.g. "SD cards".
 */
export function ActivityChart({ days, unit = "items" }: { days: ActivityDay[]; unit?: string }) {
  const totals = days.map((d) => d.sent + d.received + d.corrected);
  const top = niceMax(Math.max(0, ...totals));
  const ticks = [0, top / 2, top];
  const busy = days.filter((_, i) => totals[i] > 0).reverse();
  const mid = days[Math.floor(days.length / 2)];

  return (
    <>
      <div className={styles.legend}>
        {SERIES.map((s) => (
          <span key={s.key}>
            <i className={styles.swatch} style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div className={styles.plotWrap} style={{ paddingTop: 14 }}>
        <div className={styles.plot} style={{ height: PLOT_HEIGHT }}>
          {ticks.slice(1).map((t) => (
            <div key={t} className={styles.gridLine} style={{ bottom: `${(t / top) * 100}%` }}>
              <span>{n(t)}</span>
            </div>
          ))}
          <div className={styles.cols}>
            {days.map((d, i) => (
              <div
                key={d.date}
                className={`${styles.col} ${styles.tip}`}
                tabIndex={0}
                data-tip={`${shortDate(d.date)} · ${unit}\nSent ${d.sent}\nReceived ${d.received}\nCorrected ${d.corrected}\nTotal ${totals[i]}`}
                aria-label={`${shortDate(d.date)}: ${d.sent} ${unit} sent, ${d.received} received, ${d.corrected} corrected`}
              >
                {totals[i] > 0 && (
                  <span className={styles.colLabel} style={{ bottom: `calc(${(totals[i] / top) * 100}% + 3px)` }} aria-hidden="true">
                    {n(totals[i])}
                  </span>
                )}
                <div className={styles.stack}>
                  {SERIES.map((s) =>
                    d[s.key] > 0 ? (
                      <div
                        key={s.key}
                        className={styles.seg}
                        style={{ height: `${(d[s.key] / top) * 100}%`, background: s.color }}
                      />
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.xAxis}>
        <span>{shortDate(days[0].date)}</span>
        <span>{shortDate(mid.date)}</span>
        <span>{shortDate(days[days.length - 1].date)}</span>
      </div>

      <details className={styles.details}>
        <summary>Table view</summary>
        {busy.length === 0 ? (
          <p className={styles.muted}>No handovers in this period.</p>
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className={styles.num}>Sent</th>
                  <th className={styles.num}>Received</th>
                  <th className={styles.num}>Corrected</th>
                </tr>
              </thead>
              <tbody>
                {busy.map((d) => (
                  <tr key={d.date}>
                    <td>{shortDate(d.date)}</td>
                    <td className={styles.num}>{d.sent}</td>
                    <td className={styles.num}>{d.received}</td>
                    <td className={styles.num}>{d.corrected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </>
  );
}
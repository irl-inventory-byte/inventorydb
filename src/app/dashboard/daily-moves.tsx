import Link from "next/link";
import { ROLE_LABELS } from "@/lib/labels";
import type { Role } from "@/lib/schema";
import { compact, type MoveDay } from "@/lib/daily-moves";
import { n } from "./charts";
import styles from "./dashboard.module.css";

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayNum = (iso: string) => String(Number(iso.slice(8, 10)));

// Round a maximum up to 1, 2, 5 x 10^n so the axis ticks are clean numbers.
function niceMax(v: number) {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * mag).find((c) => c >= v) ?? v;
}

const SENT = "var(--series-1)";
const RECEIVED = "var(--series-2)";
const PLOT_HEIGHT = 200;

// Layout for this chart only (kept here so no shared CSS file has to change).
const CSS = `
.dm-filters{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:2px 0 4px}
.dm-filters label{display:flex;gap:6px;align-items:center;font-size:.9rem;color:var(--text-secondary)}
.dm-filters select{min-width:170px;max-width:260px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface-1);color:var(--text-primary);font:inherit}
.dm-filters input[type=date]{padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface-1);color:var(--text-primary);font:inherit}
.dm-filters button{padding:7px 16px;border-radius:8px;border:1px solid #1e293b;background:#1e293b;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.dm-cols{position:absolute;inset:0;display:grid;gap:6px}
.dm-day{display:flex;align-items:flex-end;justify-content:center;gap:3px;height:100%}
.dm-bar{position:relative;flex:1 1 0;max-width:30px;height:100%;display:flex;align-items:flex-end}
.dm-day:first-child::after{left:0;transform:none}
.dm-day:last-child::after{left:auto;right:0;transform:none}
.dm-fill{width:100%;border-radius:4px 4px 0 0}
.dm-val{position:absolute;left:50%;transform:translateX(-50%);font-size:.68rem;font-weight:600;line-height:1;white-space:nowrap;color:var(--text-secondary);pointer-events:none}
.dm-axis{display:grid;gap:6px;padding-left:34px;margin-top:4px;font-size:.72rem;color:var(--text-muted);text-align:center}
@media (max-width:700px){.dm-val{display:none}.dm-day{gap:1px}.dm-cols,.dm-axis{gap:2px}.dm-axis span:nth-child(even){visibility:hidden}}
`;

/**
 * "SD cards / Rigs moved per day": sent and received side by side for each day, the number on top of each
 * bar, full width so every day lines up with its date. Filters for person, city, role and a From / To date
 * range sit above the chart. Long ranges (more than 3 weeks) hide the numbers on the bars and label fewer dates.
 */
export function DailyMoves({
  title,
  unit,
  days,
  people,
  cities,
  roles,
  person,
  city,
  role,
  from,
  to,
  today,
  datesChosen,
  cut,
  keep,
}: {
  title: string;
  unit: string; // "SD cards" or "rigs"
  days: MoveDay[];
  people: { id: string; label: string; role?: string }[];
  cities: string[];
  roles: string[]; // fo, ifo, im, …
  person: string;
  city: string;
  role: string;
  from: string; // YYYY-MM-DD, first day shown
  to: string; // YYYY-MM-DD, last day shown
  today: string; // YYYY-MM-DD (India), the latest day that can be chosen
  datesChosen: boolean; // a From / To was chosen (not the default last 14 days)
  cut: boolean; // the chosen range was longer than allowed and was shortened
  keep: Record<string, string>; // other dashboard settings to keep when filtering
}) {
  const top = niceMax(Math.max(0, ...days.flatMap((d) => [d.sent, d.received])));
  const totalSent = days.reduce((s, d) => s + d.sent, 0);
  const totalReceived = days.reduce((s, d) => s + d.received, 0);
  const totalCorrected = days.reduce((s, d) => s + d.corrected, 0);
  const busy = days.filter((d) => d.sent + d.received + d.corrected > 0).reverse();
  // Many days: thinner gaps, no numbers on the bars (hover or Table view shows them), fewer date labels.
  const dense = days.length > 21;
  const step = Math.ceil(days.length / 14);
  const cols = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, ...(dense ? { gap: 2 } : {}) };
  // Quick ranges keep the person / city / role filters.
  const quick = (n: number) => {
    const q = new URLSearchParams({ ...keep, ...(person && { mperson: person }), ...(city && { mcity: city }), ...(role && { mrole: role }) });
    const start = new Date(Date.parse(`${today}T00:00:00Z`) - (n - 1) * 86_400_000).toISOString().slice(0, 10);
    q.set("mfrom", start);
    q.set("mto", today);
    return `/dashboard?${q}#moved`;
  };
  const filtered = !!(person || city || role || datesChosen);
  const roleName = (r: string) => ROLE_LABELS[r as Role] ?? r;
  // With a role chosen, the person list shows only people with that role.
  const shownPeople = role ? people.filter((p) => p.role === role || p.id === person) : people;
  const personName = people.find((p) => p.id === person)?.label ?? person;
  const clearHref = `/dashboard?${new URLSearchParams(keep)}#moved`;
  const tip = (d: MoveDay) =>
    `${shortDate(d.date)}\nSent ${n(d.sent)}\nReceived ${n(d.received)}${d.corrected ? `\nCorrected ${n(d.corrected)}` : ""}`;

  return (
    <section className={styles.card} id="moved" aria-label={title}>
      <style>{CSS}</style>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
        <span className={styles.muted}>
          {shortDate(from)} – {shortDate(to)} ({days.length} days)
        </span>
      </div>

      <form method="get" action="/dashboard#moved" className="dm-filters">
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label>
          Person
          <select name="mperson" defaultValue={person}>
            <option value="">All people</option>
            {shownPeople.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.role ? ` (${roleName(p.role)})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          City
          <select name="mcity" defaultValue={city}>
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select name="mrole" defaultValue={role}>
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {roleName(r)}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" name="mfrom" defaultValue={from} max={today} />
        </label>
        <label>
          To
          <input type="date" name="mto" defaultValue={to} max={today} />
        </label>
        <button type="submit">Apply</button>
        {filtered && (
          <Link href={clearHref} className={styles.link}>
            Clear filter
          </Link>
        )}
      </form>

      <p className={styles.muted}>
        {(person || city || role) && (
          <>
            Showing{person ? ` ${personName}` : ""}
            {role ? ` ${roleName(role)}` : ""}
            {(person || role) && city ? " in" : ""}
            {city ? ` ${city}` : ""}:{" "}
          </>
        )}
        <strong>{n(totalSent)}</strong> {unit} sent · <strong>{n(totalReceived)}</strong> received
        {totalCorrected > 0 && <> · {n(totalCorrected)} corrected</>} in {days.length} days.{" "}
        <span>
          Quick:{" "}
          {[7, 14, 30, 90].map((q, i) => (
            <span key={q}>
              {i > 0 && " · "}
              <Link href={quick(q)} className={styles.link}>
                {q} days
              </Link>
            </span>
          ))}
        </span>
        {cut && <> (A range can be at most 92 days, so it starts on {shortDate(from)}.)</>}
      </p>

      <div className={styles.legend}>
        <span>
          <i className={styles.swatch} style={{ background: SENT }} />
          Sent (check-out)
        </span>
        <span>
          <i className={styles.swatch} style={{ background: RECEIVED }} />
          Received (check-in)
        </span>
      </div>

      <div className={styles.plotWrap} style={{ paddingTop: 14 }}>
        <div className={styles.plot} style={{ height: PLOT_HEIGHT }}>
          {[top / 2, top].map((t) => (
            <div key={t} className={styles.gridLine} style={{ bottom: `${(t / top) * 100}%` }}>
              <span>{compact(t)}</span>
            </div>
          ))}
          <div className="dm-cols" style={cols}>
            {days.map((d) => (
              <div key={d.date} className={`dm-day ${styles.tip}`} tabIndex={0} data-tip={tip(d)} aria-label={tip(d).replace(/\n/g, ", ")}>
                {[
                  { v: d.sent, color: SENT },
                  { v: d.received, color: RECEIVED },
                ].map((b, i) => (
                  <div key={i} className="dm-bar">
                    {b.v > 0 && (
                      <>
                        {!dense && (
                          <span className="dm-val" style={{ bottom: `calc(${(b.v / top) * 100}% + 3px)` }} aria-hidden="true">
                            {compact(b.v)}
                          </span>
                        )}
                        <div className="dm-fill" style={{ height: `${(b.v / top) * 100}%`, background: b.color }} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="dm-axis" style={cols}>
        {days.map((d, i) => (
          <span key={d.date}>
            {i % step !== 0 ? "" : i === 0 || d.date.endsWith("-01") || step > 1 ? shortDate(d.date) : dayNum(d.date)}
          </span>
        ))}
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
                    <td className={styles.num}>{n(d.sent)}</td>
                    <td className={styles.num}>{n(d.received)}</td>
                    <td className={styles.num}>{n(d.corrected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}
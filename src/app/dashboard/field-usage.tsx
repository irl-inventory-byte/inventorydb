import Link from "next/link";
import { STATUS_LABELS } from "@/lib/labels";
import type { Status } from "@/lib/schema";
import { modelLabel, type FieldUsage, type UsageRow } from "@/lib/field-usage";
import MultiSelect from "../inventory/MultiSelect";
import { n } from "./charts";
import styles from "./dashboard.module.css";

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const when = (ts: string) =>
  ts ? new Date(Date.parse(ts)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" }) : "Never";
const daysSince = (ts: string, now: Date) => (ts ? Math.floor((now.getTime() - Date.parse(ts)) / 86_400_000) : null);

const TOP = 10;

const CSS = `
#field-usage{grid-template-columns:minmax(0,1fr)}
#field-usage>*,.fu-grid>*,.fu-list{min-width:0}
.fu-list td.fu-wrap{white-space:normal;min-width:150px}
.fu-filters{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin:2px 0 8px}
.fu-filters label{display:flex;gap:6px;align-items:center;font-size:.9rem;color:var(--text-secondary)}
.fu-filters select{min-width:150px;max-width:240px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface-1);color:var(--text-primary);font:inherit}
.fu-filters input[type=date]{padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface-1);color:var(--text-primary);font:inherit}
.fu-filters button{padding:7px 16px;border-radius:8px;border:1px solid #1e293b;background:#1e293b;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.fu-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:8px 0 14px}
.fu-kpi{border:1px solid var(--border);border-radius:10px;padding:10px 12px}
.fu-kpi strong{display:block;font-size:1.4rem}
.fu-kpi span{font-size:.82rem;color:var(--text-secondary)}
.fu-grid{display:grid;gap:18px}
.fu-list h3{margin:0 0 4px;font-size:1rem}
.fu-list p{margin:0 0 6px}
.fu-bar{display:inline-block;height:8px;border-radius:4px;background:var(--series-1);vertical-align:middle;margin-right:6px}
`;

/**
 * Field usage: which assets are used on the field the most, the least, and not at all, for the chosen
 * dates. "Used" = checked out on an FO's name. Helps decide what to rotate, recall for repair or retire.
 */
export function FieldUsageCard({
  unit,
  usage,
  from,
  to,
  today,
  city,
  person,
  model,
  includeOut,
  cities,
  fos,
  models,
  names,
  hubNames,
  keep,
  now,
}: {
  unit: string; // "rigs", "SD cards", "mobiles"
  usage: FieldUsage;
  from: string;
  to: string;
  today: string;
  city: string[];
  person: string[];
  model: string[];
  includeOut: boolean;
  cities: string[];
  fos: { id: string; label: string }[];
  models: string[];
  names: Map<string, string>; // person_id → name
  hubNames: Map<string, string>; // hub_id → name
  keep: Record<string, string>; // other dashboard settings
  now: Date;
}) {
  const { used, never } = usage;
  const most = used.slice(0, TOP);
  const least = used.length > TOP ? [...used].reverse().slice(0, TOP) : [...used].reverse();
  const maxUses = Math.max(1, ...used.map((r) => r.uses));
  const filtered = !!(city.length || person.length || model.length || includeOut);
  const clearHref = `/dashboard?${new URLSearchParams(keep)}#field-usage`;
  const quick = (days: number) => {
    const q = new URLSearchParams({
      ...keep,
      ...(city.length && { ucity: city.join(",") }),
      ...(person.length && { uperson: person.join(",") }),
      ...(model.length && { umodel: model.join(",") }),
      ...(includeOut && { uout: "1" }),
    });
    q.set("ufrom", new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10));
    q.set("uto", today);
    return `/dashboard?${q}#field-usage`;
  };
  const now_ = (r: UsageRow) => {
    const s = STATUS_LABELS[r.item.status as Status] ?? r.item.status;
    const who = r.item.current_holder ? names.get(r.item.current_holder) || r.item.current_holder : "";
    const where = hubNames.get(r.item.current_hub) || r.item.current_hub;
    return [s, who || where].filter(Boolean).join(" · ");
  };

  const table = (rows: UsageRow[], showBar: boolean) => (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Brand / model</th>
            <th className={styles.num}>Times on field</th>
            <th className={styles.num}>Days on field</th>
            <th className={styles.num}>FOs</th>
            <th>Last on field</th>
            <th>Now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const since = daysSince(r.lastUsed, now);
            return (
              <tr key={r.item.item_id}>
                <td>
                  <Link href={`/inventory/${encodeURIComponent(r.item.item_id)}`} className={styles.link}>
                    {r.item.item_id}
                  </Link>
                </td>
                <td>{modelLabel(r.item) || "—"}</td>
                <td className={styles.num}>
                  {showBar && r.uses > 0 && <i className="fu-bar" style={{ width: `${Math.max(4, (r.uses / maxUses) * 60)}px` }} />}
                  {n(r.uses)}
                </td>
                <td className={styles.num}>{r.fieldDays.toLocaleString("en-IN")}</td>
                <td className={styles.num}>{n(r.fos)}</td>
                <td className="fu-wrap">
                  {when(r.lastUsed)}
                  {since !== null && <span className={styles.muted}> ({n(since)} d ago{r.lastFo ? `, ${r.lastFo}` : ""})</span>}
                </td>
                <td className="fu-wrap">{now_(r)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className={styles.card} id="field-usage" aria-label="Field usage">
      <style>{CSS}</style>
      <div className={styles.sectionHead}>
        <h2>Field usage: {unit}</h2>
        <span className={styles.muted}>
          {shortDate(from)} – {shortDate(to)}
        </span>
      </div>
      <p className={styles.muted} style={{ marginTop: 0 }}>
        Used = checked out on an FO&apos;s name. Use it to see which {unit} work hardest, which to rotate in, and
        which to recall for repair or retire.
      </p>

      <form method="get" action="/dashboard#field-usage" className="fu-filters">
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <MultiSelect
          name="ucity"
          label="City"
          allLabel="All cities"
          options={cities.map((c) => ({ value: c, label: c }))}
          selected={city}
        />
        <MultiSelect
          name="uperson"
          label="FO"
          allLabel="All FOs"
          options={fos.map((p) => ({ value: p.id, label: p.label }))}
          selected={person}
        />
        {models.length > 1 && (
          <MultiSelect
            name="umodel"
            label="Model"
            allLabel="All models"
            options={models.map((m) => ({ value: m, label: m }))}
            selected={model}
          />
        )}
        <label>
          From
          <input type="date" name="ufrom" defaultValue={from} max={today} />
        </label>
        <label>
          To
          <input type="date" name="uto" defaultValue={to} max={today} />
        </label>
        <label>
          <input type="checkbox" name="uout" value="1" defaultChecked={includeOut} />
          Include lost / damaged / retired
        </label>
        <button type="submit">Apply</button>
        {filtered && (
          <Link href={clearHref} className={styles.link}>
            Clear filter
          </Link>
        )}
      </form>
      <p className={styles.muted} style={{ margin: "0 0 4px" }}>
        Quick:{" "}
        {[7, 30, 90].map((q, i) => (
          <span key={q}>
            {i > 0 && " · "}
            <Link href={quick(q)} className={styles.link}>
              {q} days
            </Link>
          </span>
        ))}
      </p>

      <div className="fu-kpis">
        <div className="fu-kpi">
          <strong>{n(usage.items)}</strong>
          <span>{unit} in view</span>
        </div>
        <div className="fu-kpi">
          <strong>{n(used.length)}</strong>
          <span>used on field</span>
        </div>
        <div className="fu-kpi">
          <strong>{n(never.length)}</strong>
          <span>never used on field</span>
        </div>
        <div className="fu-kpi">
          <strong>{n(usage.totalUses)}</strong>
          <span>FO check-outs</span>
        </div>
        <div className="fu-kpi">
          <strong>{used.length ? (usage.totalUses / used.length).toFixed(1) : "0"}</strong>
          <span>times per used item</span>
        </div>
      </div>

      <div className="fu-grid">
        <div className="fu-list">
          <h3>Most used on field</h3>
          <p className={styles.muted}>Most FO check-outs first. Candidates for a check-up or repair before they fail.</p>
          {most.length ? table(most, true) : <p className={styles.muted}>No {unit} were checked out to an FO in this period.</p>}
        </div>

        <div className="fu-list">
          <h3>Least used on field</h3>
          <p className={styles.muted}>Used at least once, fewest check-outs first. Rotate these in before buying more.</p>
          {least.length ? table(least, true) : <p className={styles.muted}>None.</p>}
        </div>

        <div className="fu-list">
          <h3>Never used on field ({n(never.length)})</h3>
          <p className={styles.muted}>
            Not checked out to an FO in this period
            {person.length ? " (the FO filter does not apply here)" : ""}. Longest since last use first: check, recall or
            retire.
          </p>
          {never.length ? table(never.slice(0, TOP), false) : <p className={styles.muted}>Every {unit.replace(/s$/, "")} in view was used.</p>}
        </div>

        {(used.length > TOP || never.length > TOP) && (
          <details className={styles.details}>
            <summary>
              All {n(used.length + never.length)} {unit}, most used first
            </summary>
            {table([...used, ...never], true)}
          </details>
        )}
      </div>
    </section>
  );
}

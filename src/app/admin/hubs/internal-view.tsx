import Link from "next/link";
import type { Hub, Item, ItemEvent } from "@/lib/schema";
import { STATUS_LABELS } from "@/lib/labels";
import { formatIst } from "@/lib/time";
import { n } from "../charts";
import styles from "../dashboard.module.css";

const MOVES_SHOWN = 15;
const days = (d: number | null) => (d === null ? "—" : d === 0 ? "today" : `${d}d`);

/**
 * "Internal" isn't a real hub — it's the free-text name typed into the send form when items go to
 * someone on the internal team (see lib/handover.ts's planSend: status becomes "with_internal", and the
 * typed name is used as-is for current_holder since there's no Person row for it). The item itself stays
 * recorded at whichever hub it was sent to, so there's no hub_id to scope by — this groups by status
 * instead, across every hub. Rendered by dashboard/hub/[id]/page.tsx for the special id "internal", which
 * dashboard/page.tsx links to from a synthetic "Internal" box in the Hub hierarchy chart.
 */
export function InternalView({ items, events, hubs }: { items: Item[]; events: ItemEvent[]; hubs: Hub[] }) {
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const here = items.filter((i) => i.status === "with_internal").sort((a, b) => a.item_id.localeCompare(b.item_id));

  // Most recent event time per card, same approach as lib/dashboard.ts's ageDays.
  const lastAt = new Map<string, number>();
  for (const e of events) {
    const t = Date.parse(e.occurred_at);
    if (!Number.isNaN(t) && t > (lastAt.get(e.item_id) ?? -Infinity)) lastAt.set(e.item_id, t);
  }
  const ageDays = (i: Item): number | null => {
    const t = lastAt.get(i.item_id) ?? Date.parse(i.updated_at);
    return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
  };

  // current_holder is the typed name itself here (no person_id to look up), so group directly on it.
  const holderMap = new Map<string, Item[]>();
  for (const i of here) holderMap.set(i.current_holder, [...(holderMap.get(i.current_holder) ?? []), i]);
  const holders = [...holderMap.entries()]
    .map(([name, list]) => ({
      name: name || "Unknown",
      count: list.length,
      oldestDays: list.reduce((max: number | null, i) => {
        const a = ageDays(i);
        return a === null ? max : max === null ? a : Math.max(max, a);
      }, null as number | null),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const moves = events
    .filter((e) => e.status_after === "with_internal")
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, MOVES_SHOWN);

  return (
    <div className={styles.root}>
      <main className={styles.wrap}>
        <nav className={styles.crumbs} aria-label="Hub path">
          <Link href="/dashboard">Dashboard</Link>
          {" › "}
          <strong>Internal</strong>
        </nav>

        <h1>Internal</h1>
        <p className={styles.muted}>
          Items held by the internal team — typed in by name on the send form, not tied to any one hub. {n(here.length)}{" "}
          item{here.length === 1 ? "" : "s"}.
        </p>

        {here.length === 0 ? (
          <section className={styles.card} aria-label="Items here">
            <h2>Items</h2>
            <p className={styles.muted}>Nothing is with the internal team right now.</p>
          </section>
        ) : (
          <section className={styles.card} aria-label="Items here">
            <h2>Items ({n(here.length)})</h2>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <thead>
                  <tr>
                    <th>Serial</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Holder</th>
                    <th>Hub</th>
                  </tr>
                </thead>
                <tbody>
                  {here.map((i) => (
                    <tr key={i.item_id}>
                      <td>
                        <Link href={`/inventory/${i.item_id}`}>{i.item_id}</Link>
                      </td>
                      <td>{i.model || i.prism_no}</td>
                      <td>{STATUS_LABELS[i.status] ?? i.status}</td>
                      <td>{i.current_holder || "—"}</td>
                      <td>{hubName.get(i.current_hub) ?? i.current_hub}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className={styles.card} aria-label="Who has items">
          <h2>Who has items</h2>
          {holders.length === 0 ? (
            <p className={styles.muted}>Nobody currently has internal items.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className={styles.num}>Items</th>
                    <th className={styles.num}>Longest</th>
                  </tr>
                </thead>
                <tbody>
                  {holders.map((h) => (
                    <tr key={h.name}>
                      <td>{h.name}</td>
                      <td className={styles.num}>{n(h.count)}</td>
                      <td className={styles.num}>{days(h.oldestDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.card} aria-label="Recent movements">
          <h2>Recent movements</h2>
          <p className={styles.muted}>The latest {MOVES_SHOWN} handovers that sent items to the internal team. Times are IST.</p>
          {moves.length === 0 ? (
            <p className={styles.muted}>No movements recorded yet.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Item</th>
                    <th>To</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((e) => (
                    <tr key={e.event_id}>
                      <td>{formatIst(e.occurred_at)}</td>
                      <td>
                        <Link href={`/inventory/${e.item_id}`}>{e.item_id}</Link>
                      </td>
                      <td>
                        {hubName.get(e.hub) ?? e.hub}
                        {e.to_person ? ` (${e.to_person})` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className={styles.muted}>
          <Link href="/dashboard" className={styles.link}>
            ← Back to the dashboard
          </Link>
        </p>
      </main>
    </div>
  );
}
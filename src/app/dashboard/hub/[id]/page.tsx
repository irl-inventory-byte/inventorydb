import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/authz";
import { computeDashboard } from "@/lib/dashboard";
import { buildHubTree, findNode, pathTo, subtreeIds } from "@/lib/hub-tree";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import type { Action, Status } from "@/lib/schema";
import { storeFor, typeParam } from "@/lib/access";
import { formatIst } from "@/lib/time";
import { n } from "../../charts";
import { Collapsible } from "../../collapsible";
import styles from "../../dashboard.module.css";
import { breakdown } from "../../hub-tree-view";
import { SummaryKpis } from "../../summary-kpis";

const ACTION_LABELS: Record<Action, string> = {
  check_out: "Sent",
  check_in: "Checked in",
  receive: "Received",
  report_lost: "Reported lost",
  report_damaged: "Reported damaged",
  retire: "Retired",
  reassign_home_hub: "Home hub changed",
  correct: "Corrected",
  import: "Imported",
};

const CARDS_SHOWN = 50;
const MOVES_SHOWN = 15;
const days = (d: number | null) => (d === null ? "—" : d === 0 ? "today" : `${d}d`);

export default async function HubDetailPage({ params, searchParams }: PageProps<"/dashboard/hub/[id]">) {
  const user = await requireRole();
  const { id } = await params;
  const sp = await searchParams;
  const store = storeFor(user.role, typeParam(one(sp.type), user.role));
  const [items, events, people, hubs] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("people"),
    store.list("hubs"),
  ]);

  const roots = buildHubTree(hubs, items);
  const node = findNode(roots, id);
  if (!node) notFound();

  // A parent hub shows itself plus everything under it, unless "this hub only" is chosen.
  const hasSub = node.children.length > 0;
  const withSub = hasSub && one(sp.sub) !== "0";
  const scope = withSub ? subtreeIds(node) : [node.hub.hub_id];
  const inScope = new Set(scope);
  const d = computeDashboard(items, events, people, hubs, { hub: "", scope, days: 30, now: new Date() });

  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));
  const hubParam = scope.join(",");
  const inventory = (params: Record<string, string>) => `/inventory?${new URLSearchParams({ hub: hubParam, ...params })}`;

  const s = d.byStatus;
  const tiles = [
    { label: "Items", value: d.total, href: inventory({}) },
    { label: "In stock", value: s.in_stock, href: inventory({ status: "in_stock" }) },
    { label: "With field officers", value: s.with_fo, href: inventory({ status: "with_fo" }) },
    { label: "With rig team", value: s.with_rig, href: inventory({ status: "with_rig" }) },
    { label: "Internal", value: s.with_internal, href: inventory({ status: "with_internal" }) },
    { label: "In transit", value: s.traveling + s.pending, href: inventory({ status: "traveling,pending" }) },
    { label: "Lost or damaged", value: s.lost + s.damaged, href: inventory({ status: "lost,damaged" }) },
  ];

  // Cards here, the ones out first (they need attention), then by serial.
  const here = items
    .filter((i) => inScope.has(i.current_hub))
    .sort((a, b) => Number(a.status === "in_stock") - Number(b.status === "in_stock") || a.item_id.localeCompare(b.item_id));

  // Movements that started or ended at a hub in this scope, newest first.
  const moves = events
    .filter((e) => inScope.has(e.hub) || inScope.has(e.from_hub))
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, MOVES_SHOWN);

  const team = people
    .filter((p) => inScope.has(p.hub) && p.active !== "false")
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));

  // "9 IM · 1 FO": how the people split by role, for the collapsed People block.
  const roleSummary = (["im", "ifo", "fo", "rig"] as const)
    .map((r) => [r, team.filter((p) => p.role === r).length] as const)
    .filter(([, count]) => count > 0)
    .map(([r, count]) => `${count} ${ROLE_LABELS[r]}`)
    .join(" · ");

  const crumbs = pathTo(node);
  const otherName = (hubId: string) => hubName.get(hubId) ?? hubId;

  return (
    <div className={styles.root}>
      <main className={styles.wrap}>
        <nav className={styles.crumbs} aria-label="Hub path">
          <Link href="/dashboard">Dashboard</Link>
          {crumbs.map((c, i) => (
            <span key={c.hub.hub_id}>
              {"› "}
              {i === crumbs.length - 1 ? <strong>{c.hub.name}</strong> : <Link href={`/dashboard/hub/${c.hub.hub_id}`}>{c.hub.name}</Link>}
            </span>
          ))}
        </nav>

        <h1>{node.hub.name}</h1>
        <p className={styles.muted}>
          {node.hub.city && node.hub.city !== node.hub.name ? `${node.hub.city} · ` : ""}
          {node.hub.is_central === "true" ? "Main hub · " : ""}
          {node.hub.active === "false" ? "Inactive · " : ""}
          Owns {n(node.owned)} items · {hasSub ? `${node.children.length} hub${node.children.length === 1 ? "" : "s"} under it` : "no hubs under it"}
        </p>

        {hasSub && (
          <div className={styles.toggle} role="group" aria-label="Scope">
            {withSub ? <span className={styles.toggleOn}>This hub and its sub-hubs</span> : <Link href={`/dashboard/hub/${id}`}>This hub and its sub-hubs</Link>}
            {withSub ? <Link href={`/dashboard/hub/${id}?sub=0`}>This hub only</Link> : <span className={styles.toggleOn}>This hub only</span>}
          </div>
        )}

        <SummaryKpis d={d} hubParam={hubParam} items={items} />

        <section className={styles.tiles} aria-label="Stock at this hub">
          {tiles.map((t) => (
            <Link key={t.label} href={t.href} className={styles.tile}>
              <span className={styles.tileLabel}>{t.label}</span>
              <span className={styles.tileValue}>{n(t.value)}</span>
            </Link>
          ))}
        </section>

        {hasSub && (
          <section className={styles.card} aria-label="Hubs under this hub">
            <h2>Hubs under {node.hub.name}</h2>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Hub</th>
                    <th className={styles.num}>Items</th>
                    <th>Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{node.hub.name} (itself)</td>
                    <td className={styles.num}>{n(node.own.held)}</td>
                    <td>{breakdown(node.own)}</td>
                  </tr>
                  {node.children.map((c) => (
                    <tr key={c.hub.hub_id}>
                      <td>
                        <Link href={`/dashboard/hub/${c.hub.hub_id}`}>{c.hub.name}</Link>
                        {c.children.length > 0 && <span className={styles.muted}> · {c.children.length} under it</span>}
                      </td>
                      <td className={styles.num}>{n(c.total.held)}</td>
                      <td>{breakdown(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {here.length === 0 ? (
          <section className={styles.card} aria-label="Items here">
            <h2>Items here</h2>
            <p className={styles.muted}>No items at {withSub ? "this hub or the hubs under it" : "this hub"} right now.</p>
          </section>
        ) : (
          <Collapsible title="Items here" count={n(here.length)} meta={breakdown(withSub ? node.total : node.own)}>
            {here.length > CARDS_SHOWN && (
              <p className={styles.muted}>
                Showing the first {CARDS_SHOWN}, items that are out first.{" "}
                <Link href={inventory({})} className={styles.link}>
                  See all {n(here.length)} in the inventory list
                </Link>
              </p>
            )}
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <thead>
                  <tr>
                    <th>Serial</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Holder</th>
                    {scope.length > 1 && <th>Hub</th>}
                  </tr>
                </thead>
                <tbody>
                  {here.slice(0, CARDS_SHOWN).map((i) => (
                    <tr key={i.item_id}>
                      <td>
                        <Link href={`/inventory/${i.item_id}`}>{i.item_id}</Link>
                      </td>
                      <td>{i.model || i.prism_no}</td>
                      <td>{STATUS_LABELS[i.status as Status] ?? i.status}</td>
                      <td>{personName.get(i.current_holder) ?? i.current_holder}</td>
                      {scope.length > 1 && <td>{otherName(i.current_hub)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Collapsible>
        )}

        <div className={styles.grid2}>
          <section className={styles.card} aria-label="Who has items here">
            <h2>Who has items</h2>
            {d.holders.length === 0 ? (
              <p className={styles.muted}>Nothing is out from here right now.</p>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th className={styles.num}>Items</th>
                      <th className={styles.num}>Longest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.holders.map((h) => (
                      <tr key={h.person_id}>
                        <td>
                          <Link href={`/inventory?${new URLSearchParams({ holder: h.person_id })}`}>{h.name}</Link>
                          {h.role && <span className={styles.muted}> · {ROLE_LABELS[h.role]}</span>}
                        </td>
                        <td className={styles.num}>{n(h.count)}</td>
                        <td className={styles.num}>{days(h.oldestDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.card} aria-label="Waiting to be received here">
            <h2>Waiting to be received</h2>
            {d.pending.length === 0 ? (
              <p className={styles.muted}>No items are on their way here.</p>
            ) : (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Receiving hub</th>
                      <th className={styles.num}>Items</th>
                      <th className={styles.num}>Waiting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.pending.map((p) => (
                      <tr key={p.hub_id}>
                        <td>
                          <Link href={`/handover/receive?${new URLSearchParams({ hub: p.hub_id })}`}>{p.name}</Link>
                        </td>
                        <td className={styles.num}>{n(p.count)}</td>
                        <td className={styles.num}>{days(p.oldestDays)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <section className={styles.card} aria-label="Recent movements">
          <h2>Recent movements</h2>
          <p className={styles.muted}>The latest {MOVES_SHOWN} handovers that started or ended here. Times are IST.</p>
          {moves.length === 0 ? (
            <p className={styles.muted}>No movements recorded yet.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Item</th>
                    <th>From → To</th>
                    <th>Now</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map((e) => (
                    <tr key={e.event_id}>
                      <td>{formatIst(e.occurred_at)}</td>
                      <td>{ACTION_LABELS[e.action] ?? e.action}</td>
                      <td>
                        <Link href={`/inventory/${e.item_id}`}>{e.item_id}</Link>
                      </td>
                      <td>
                        {e.from_hub ? `${otherName(e.from_hub)}` : "—"}
                        {e.from_person ? ` (${e.from_person})` : ""} → {otherName(e.hub)}
                        {e.to_person ? ` (${e.to_person})` : ""}
                      </td>
                      <td>{STATUS_LABELS[e.status_after] ?? e.status_after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {team.length === 0 ? (
          <section className={styles.card} aria-label="People at this hub">
            <h2>People</h2>
            <p className={styles.muted}>Nobody is listed under {withSub ? "this hub or the hubs under it" : "this hub"} in the People tab.</p>
          </section>
        ) : (
          <Collapsible title="People" count={n(team.length)} meta={roleSummary}>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.tableCompact}`}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    {scope.length > 1 && <th>Hub</th>}
                  </tr>
                </thead>
                <tbody>
                  {team.map((p) => (
                    <tr key={p.person_id}>
                      <td>{p.name}</td>
                      <td>{ROLE_LABELS[p.role]}</td>
                      {scope.length > 1 && <td>{otherName(p.hub)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Collapsible>
        )}

        <p className={styles.muted}>
          <Link href="/dashboard" className={styles.link}>
            ← Back to the dashboard
          </Link>
        </p>
      </main>
    </div>
  );
}
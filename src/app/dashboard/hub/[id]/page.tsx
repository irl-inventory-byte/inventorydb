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
  rnd: "Moved to R&D",
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
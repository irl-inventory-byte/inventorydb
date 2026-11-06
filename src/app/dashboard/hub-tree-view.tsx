import Link from "next/link";
import type { HubNode, HubStats } from "@/lib/hub-tree";
import { n } from "./charts";
import styles from "./dashboard.module.css";

/** "117 in stock · 3 with FO": only the parts that are not zero, in-stock first. */
export function breakdown(s: HubStats): string {
  return [
    `${n(s.byStatus.in_stock)} in stock`,
    s.byStatus.pending > 0 && `${n(s.byStatus.pending)} incoming`,
    s.byStatus.with_fo > 0 && `${n(s.byStatus.with_fo)} with FO`,
    s.byStatus.with_rig > 0 && `${n(s.byStatus.with_rig)} with rig`,
    s.byStatus.with_internal > 0 && `${n(s.byStatus.with_internal)} internal`,
    s.byStatus.traveling > 0 && `${n(s.byStatus.traveling)} traveling`,
    s.byStatus.lost + s.byStatus.damaged > 0 && `${n(s.byStatus.lost + s.byStatus.damaged)} lost or damaged`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Hubs with no cards anywhere under them are hidden unless asked for. Top-level hubs always show. */
export const isVisible = (node: HubNode, showEmpty: boolean) => showEmpty || node.total.held > 0 || !node.parent;

export function countHidden(nodes: HubNode[], showEmpty: boolean): number {
  return nodes.reduce(
    (sum, node) => sum + (isVisible(node, showEmpty) ? countHidden(node.children, showEmpty) : 1 + countHidden(node.children, true)),
    0,
  );
}

/** One hub as a box: name, cards held (with the hubs under it), a stock bar and the numbers behind it. */
function Box({ node }: { node: HubNode }) {
  const t = node.total;
  const problem = t.byStatus.lost + t.byStatus.damaged;
  const segments = [
    { key: "stock", label: "in stock", value: t.inStock, cls: styles.segStock },
    { key: "out", label: "out with someone", value: t.out, cls: styles.segOut },
    { key: "problem", label: "lost or damaged", value: problem, cls: styles.segProblem },
    { key: "retired", label: "retired", value: t.byStatus.retired, cls: styles.segRetired },
  ].filter((s) => s.value > 0);
  const inSubHubs = t.held - node.own.held;

  return (
    <Link href={`/dashboard/hub/${node.hub.hub_id}`} className={styles.orgBox}>
      <span className={styles.orgName}>
        {node.hub.name}
        {node.hub.is_central === "true" && <span className={styles.treeTag}>main hub</span>}
        {node.hub.active === "false" && <span className={styles.treeTag}>inactive</span>}
      </span>
      <span className={styles.orgCount}>
        {n(t.held)} <small>{t.held === 1 ? "item" : "items"}</small>
      </span>
      {t.held > 0 && (
        <span
          className={styles.orgBar}
          role="img"
          aria-label={segments.map((s) => `${n(s.value)} ${s.label}`).join(", ")}
        >
          {segments.map((s) => (
            <i key={s.key} className={s.cls} style={{ flexGrow: s.value }} />
          ))}
        </span>
      )}
      <span className={styles.orgMeta}>
        {n(t.inStock)} in stock · {n(t.out)} out
      </span>
      {node.children.length > 0 && (
        <span className={styles.orgMeta}>
          {n(node.own.held)} here · {n(inSubHubs)} in sub-hubs
        </span>
      )}
    </Link>
  );
}

/**
 * A box styled like a hub box, for items with an Internal person — shown alongside the hub tree since
 * "Internal" isn't a real location (see dashboard/page.tsx's isInternalTeamHub), so it can't be a node
 * in the tree itself. Links to the Internal items list instead of a hub page.
 */
export function InternalBox({ count, href }: { count: number; href: string }) {
  return (
    <Link href={href} className={styles.orgBox}>
      <span className={styles.orgName}>Internal</span>
      <span className={styles.orgCount}>
        {n(count)} <small>{count === 1 ? "item" : "items"}</small>
      </span>
      {count > 0 && (
        <span className={styles.orgBar} role="img" aria-label={`${n(count)} with an Internal person`}>
          <i className={styles.segOut} style={{ flexGrow: 1 }} />
        </span>
      )}
      <span className={styles.orgMeta}>{n(count)} with an Internal person</span>
    </Link>
  );
}

function Level({ nodes, showEmpty }: { nodes: HubNode[]; showEmpty: boolean }) {
  const shown = nodes.filter((node) => isVisible(node, showEmpty));
  if (shown.length === 0) return null;
  return (
    <ul>
      {shown.map((node) => (
        <li key={node.hub.hub_id}>
          <Box node={node} />
          <Level nodes={node.children} showEmpty={showEmpty} />
        </li>
      ))}
    </ul>
  );
}

const LEGEND = [
  { label: "In stock", cls: styles.segStock },
  { label: "Out with someone", cls: styles.segOut },
  { label: "Lost or damaged", cls: styles.segProblem },
  { label: "Retired", cls: styles.segRetired },
];

/** The hub hierarchy as a tree chart: the main hub at the top, the hubs under it below, joined by lines. */
export function HubOrgChart({
  roots,
  showEmpty,
  internalCount,
  internalHref,
}: {
  roots: HubNode[];
  showEmpty: boolean;
  // "Internal" isn't a hub, so it's shown as its own box alongside the tree rather than inside it.
  // Omit both to leave it out.
  internalCount?: number;
  internalHref?: string;
}) {
  return (
    <>
      <div className={styles.orgScroll}>
        <div className={styles.org}>
          <Level nodes={roots} showEmpty={showEmpty} />
          {internalCount !== undefined && internalHref !== undefined && (
            <div style={{ marginTop: 10 }}>
              <InternalBox count={internalCount} href={internalHref} />
            </div>
          )}
        </div>
      </div>
      <div className={styles.legend} aria-label="Bar colors">
        {LEGEND.map((l) => (
          <span key={l.label}>
            <i className={`${styles.swatch} ${l.cls}`} />
            {l.label}
          </span>
        ))}
      </div>
    </>
  );
}
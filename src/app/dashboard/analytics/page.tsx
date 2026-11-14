import Link from "next/link";
import type { CSSProperties } from "react";
import { requireRole } from "@/lib/authz";
import { LATE_AFTER_HOURS, computeDashboard } from "@/lib/dashboard";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import type { QcCheck, Status } from "@/lib/schema";
import { storeFor, typeParam } from "@/lib/access";
import { rigTeamHubs, productivityTeamHubs } from "@/lib/rig-hub";
import { RIG_STATES, RIG_STATE_LABELS, rigState } from "@/lib/rig-state";
import TypeSwitch from "../../TypeSwitch";
import { ActivityChart, BarList, n } from "../charts";
import styles from "../dashboard.module.css";

const RANGES = [7, 30, 90];

const inventory = (params: Record<string, string>) =>
  `/inventory?${new URLSearchParams(params)}`;

const days = (d: number | null) =>
  d === null ? "—" : d === 0 ? "today" : `${d}d`;

// Problem states carry an icon and a label, never color alone.
const TILES: {
  status: Status;
  icon?: {
    glyph: string;
    tone: "critical" | "warning" | "muted";
  };
}[] = [
  { status: "in_stock" },
  { status: "with_fo" },
  { status: "traveling" },
  { status: "with_rig" },
  { status: "with_internal" },
  { status: "pending" },
  // Rig-only statuses (see lib/schema.ts) — without these, rig items sent to/with QC or hardware simply
  // vanish from this page's tiles and total instead of being counted anywhere, which is why this page's
  // "items in total" could disagree with the main dashboard's own total for the same type.
  { status: "pending_qc" },
  { status: "with_qc" },
  { status: "pending_hardware" },
  { status: "with_hardware" },
  { status: "lost", icon: { glyph: "✕", tone: "critical" } },
  { status: "damaged", icon: { glyph: "▲", tone: "warning" } },
  { status: "retired", icon: { glyph: "●", tone: "muted" } },
  { status: "rnd", icon: { glyph: "●", tone: "muted" } },
];

const TONE = {
  critical: styles.iconCritical,
  warning: styles.iconWarning,
  muted: styles.iconMuted,
};

const holderScrollStyle: CSSProperties = {
  maxHeight: "400px",
  maxWidth: "100%",
  overflowY: "auto",
  overflowX: "auto",
  position: "relative",
  isolation: "isolate",
};

const holderTableStyle: CSSProperties = {
  width: "100%",
  minWidth: "420px",
  borderCollapse: "separate",
  borderSpacing: 0,
};

const stickyHeaderStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  backgroundColor: "#1e293b",
  color: "#ffffff",
};

const stickyTotalStyle: CSSProperties = {
  position: "sticky",
  bottom: 0,
  zIndex: 2,
  backgroundColor: "#1e293b",
  color: "#ffffff",
  borderTop: "2px solid #64748b",
  fontWeight: 700,
};

const nameCellStyle: CSSProperties = {
  whiteSpace: "normal",
  overflow: "visible",
  textOverflow: "clip",
  overflowWrap: "anywhere",
  maxWidth: "none",
};

const fullNameStyle: CSSProperties = {
  display: "block",
  whiteSpace: "normal",
  overflow: "visible",
  textOverflow: "clip",
  overflowWrap: "anywhere",
  maxWidth: "none",
  maxHeight: "none",
  WebkitLineClamp: "unset",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { [key: string]: string | string[] | undefined } | Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireRole();

  const sp = await searchParams;
  const type = typeParam(one(sp.type), user.role);
  const store = storeFor(user.role, type);

  const rigView = type === "rig";
  const mobileView = type === "mobile";
  const powerBankView = type === "power_bank";

  const [items, events, people, hubs, qcChecks, settings] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("people"),
    store.list("hubs"),
    rigView ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
    store.list("settings"),
  ]);

  const hub = hubs.some((h) => h.hub_id === one(sp.hub))
    ? one(sp.hub)
    : "";

  const period = one(sp.days);
  const isYesterday = period === "yesterday";

  const range = isYesterday
    ? 1
    : RANGES.includes(Number(period))
      ? Number(period)
      : 30;

  const d = computeDashboard(items, events, people, hubs, {
    hub,
    days: range,
    now: new Date(),
    endOffsetDays: isYesterday ? 1 : 0,
  });

  // Includes every holder row, not only the visible scroll area.
  // The selected hub filter is already reflected in d.holders.
  const holderGrandTotal = d.holders.reduce(
    (total, holder) => total + holder.count,
    0
  );

  const hubScope: Record<string, string> = hub ? { hub } : {};

  const scopeName = hub
    ? (hubs.find((h) => h.hub_id === hub)?.name ?? hub)
    : "all hubs";

  // "With rig team" and "In stock" are re-bucketed here the same way the main dashboard's Fleet tile
  // does it (see dashboard/page.tsx's "teamItemsFor"/"inStockValue"): an item physically in stock at a
  // Rig team or Productivity team hub counts as "With rig team", not plain "In stock" — otherwise this
  // page's tiles (built straight from d.byStatus, which only looks at the raw item status) disagree with
  // the main dashboard's numbers for the same two buckets, even though the total is the same either way.
  const teamHubIds = new Set<string>([...rigTeamHubs(hubs), ...productivityTeamHubs(hubs)].map((h) => h.hub_id));
  const withRigTeamValue = items.filter(
    (i) => i.status === "with_rig" || (i.status === "in_stock" && teamHubIds.has(i.current_hub)),
  ).length;
  const inStockValue = items.filter((i) => i.status === "in_stock" && !teamHubIds.has(i.current_hub)).length;
  // "Broken" is also adjusted here, the same way as the main dashboard's Broken tile (dashboard/page.tsx):
  // the raw status count alone (d.byStatus.damaged) leaves out the admin's manual "starting count" baseline
  // for cards broken before this system tracked them — which is why this page's Broken tile could read a
  // small live count (e.g. 1) while the main dashboard showed a much bigger number (e.g. 89) for the same
  // thing. storageOverride is read from the "broken_storage" setting, same key the dashboard uses.
  let brokenStorageOverride: { gb256: number; gb512: number } | undefined;
  try {
    const raw = settings.find((s) => s.key === "broken_storage")?.value;
    const parsed = raw ? JSON.parse(raw) : undefined;
    if (parsed && Number.isFinite(parsed.gb256) && Number.isFinite(parsed.gb512)) brokenStorageOverride = parsed;
  } catch {
    // Malformed stored value — fall back to the live count.
  }
  const brokenBaselineTotal = (brokenStorageOverride?.gb256 ?? 0) + (brokenStorageOverride?.gb512 ?? 0);
  const brokenSdOnly = items.filter((i) => i.item_type === "sd_card" && i.status === "damaged").length;
  const brokenValue = brokenStorageOverride ? brokenSdOnly + brokenBaselineTotal : brokenSdOnly;

  const byStatusAdjusted: Record<Status, number> = {
    ...d.byStatus,
    with_rig: withRigTeamValue,
    in_stock: inStockValue,
    damaged: brokenValue,
  };

  // Rigs have their own, richer breakdown (same as the main dashboard's Rig tab, lib/rig-state.ts):
  // In stock, With hardware team, With field officer, In transit, Internal, QC pending/passed/fail,
  // RTD, Dead/Retired, R&D — a much finer split than the plain Status column rigs otherwise share with
  // SD cards, mobiles and power banks. Built the same way as dashboard/page.tsx's rigKpis, so the two
  // pages' numbers agree for every one of these states, not just "With rig team"/"In stock".
  const latestQc = new Map<string, string>();
  for (const c of qcChecks) latestQc.set(c.item_id, c.qc_status);
  const rigCount = Object.fromEntries(RIG_STATES.map((k) => [k, 0])) as Record<(typeof RIG_STATES)[number], number>;
  if (rigView) {
    for (const i of items) {
      const st = rigState(i.status, latestQc.get(i.item_id));
      if (st === "lost" || st === "other") continue; // not part of RIG_STATES, shown via the Lost/Damaged tile below
      rigCount[st] = (rigCount[st] ?? 0) + 1;
    }
  }
  const rigLostCount = items.filter((i) => i.item_type === "rig" && (i.status === "lost" || i.status === "damaged")).length;
  const RIG_STATE_HREF: Record<(typeof RIG_STATES)[number], Status[]> = {
    in_stock: ["in_stock", "pending"],
    hardware: ["with_hardware"],
    fo: ["with_fo"],
    transit: ["traveling"],
    internal: ["with_internal"],
    qc_pending: ["pending_qc", "with_qc"],
    qc_pass: ["pending"],
    qc_fail: ["with_qc", "pending_hardware"],
    rtd: ["pending", "with_hardware"],
    dead: ["retired"],
    rnd: ["rnd"],
  };
  const rigStatusRows = RIG_STATES.filter((k) => rigCount[k] > 0)
    .sort((a, b) => rigCount[b] - rigCount[a])
    .map((k) => ({
      key: k,
      label: RIG_STATE_LABELS[k],
      value: rigCount[k],
      href: inventory({ status: RIG_STATE_HREF[k].join(","), type: "rig", ...hubScope }),
      tip: `${RIG_STATE_LABELS[k]}\n${n(rigCount[k])} rigs (${((rigCount[k] / Math.max(1, d.total)) * 100).toFixed(1)}%)`,
    }));

  // Mobiles and power banks don't go through the rig/QC/hardware flow or the rig team, so most of the
  // generic TILES list (With rig team, Internal, Pending receipt, R&D, and — for power banks — Broken,
  // which has no meaning there either, see dashboard/page.tsx) never applies to them and was showing up
  // here anyway with meaningless zeroes. Same tile set as the main dashboard's Mobile/Power bank tabs,
  // with "In transit" folding traveling + pending into one number like the dashboard does.
  type SimpleTile = {
    key: string;
    label: string;
    value: number;
    href: string;
    icon?: { glyph: string; tone: "critical" | "warning" | "muted" };
  };
  const simpleTiles: SimpleTile[] | null = mobileView
    ? [
        { key: "in_stock", label: "In stock", value: d.byStatus.in_stock, href: inventory({ status: "in_stock", ...hubScope }) },
        { key: "with_fo", label: "With field officers", value: d.byStatus.with_fo, href: inventory({ status: "with_fo", ...hubScope }) },
        { key: "with_internal", label: "Internal", value: d.byStatus.with_internal, href: inventory({ status: "with_internal", ...hubScope }) },
        {
          key: "transit",
          label: "In transit",
          value: d.byStatus.traveling + d.byStatus.pending,
          href: inventory({ status: "traveling,pending", ...hubScope }),
        },
        { key: "lost", label: "Lost", value: d.byStatus.lost, href: inventory({ status: "lost", ...hubScope }), icon: { glyph: "✕", tone: "critical" } },
        { key: "damaged", label: "Broken", value: d.byStatus.damaged, href: inventory({ status: "damaged", ...hubScope }), icon: { glyph: "▲", tone: "warning" } },
        { key: "retired", label: "Retired", value: d.byStatus.retired, href: inventory({ status: "retired", ...hubScope }), icon: { glyph: "●", tone: "muted" } },
      ]
    : powerBankView
      ? [
          { key: "in_stock", label: "In stock", value: d.byStatus.in_stock, href: inventory({ status: "in_stock", ...hubScope }) },
          { key: "with_fo", label: "With field officers", value: d.byStatus.with_fo, href: inventory({ status: "with_fo", ...hubScope }) },
          {
            key: "transit",
            label: "In transit",
            value: d.byStatus.traveling + d.byStatus.pending,
            href: inventory({ status: "traveling,pending", ...hubScope }),
          },
          { key: "lost", label: "Lost", value: d.byStatus.lost, href: inventory({ status: "lost", ...hubScope }), icon: { glyph: "✕", tone: "critical" } },
          { key: "retired", label: "Retired", value: d.byStatus.retired, href: inventory({ status: "retired", ...hubScope }), icon: { glyph: "●", tone: "muted" } },
        ]
      : null;
  const simpleStatusRows = simpleTiles
    ?.filter((t) => t.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((t) => ({
      key: t.key,
      label: t.label,
      value: t.value,
      href: t.href,
      tip: `${t.label}\n${n(t.value)} items (${((t.value / Math.max(1, d.total)) * 100).toFixed(1)}%)`,
    }));

  const statusRows = TILES.map((t) => t.status)
    .filter((s) => byStatusAdjusted[s] > 0)
    .sort((a, b) => byStatusAdjusted[b] - byStatusAdjusted[a])
    .map((s) => ({
      key: s,
      label: STATUS_LABELS[s],
      value: byStatusAdjusted[s],
      href: inventory({ status: s, ...hubScope }),
      tip: `${STATUS_LABELS[s]}\n${n(byStatusAdjusted[s])} items (${(
        (byStatusAdjusted[s] / Math.max(1, d.total)) *
        100
      ).toFixed(1)}%)`,
    }));

  return (
    <div className={styles.root}>
      <main className={styles.wrap}>
        <p className={styles.back}>
          <Link href="/dashboard">← Dashboard</Link>
        </p>

        <h1>More analytics</h1>

        <TypeSwitch role={user.role} current={type} path="/dashboard/analytics" params={{ hub: one(sp.hub) }} />

        <form className={styles.filters} method="get">
          <select name="hub" defaultValue={hub} aria-label="Hub">
            <option value="">All hubs</option>

            {[...hubs]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((h) => (
                <option key={h.hub_id} value={h.hub_id}>
                  {h.name}
                </option>
              ))}
          </select>

          <select
            name="days"
            defaultValue={isYesterday ? "yesterday" : String(range)}
            aria-label="Activity period"
          >
            <option value="yesterday">Activity: yesterday</option>

            {RANGES.map((r) => (
              <option key={r} value={r}>
                Activity: last {r} days
              </option>
            ))}
          </select>

          <button type="submit">Apply</button>

          {(hub || isYesterday || range !== 30) && (
            <Link href="/dashboard/analytics" className={styles.link}>
              Reset
            </Link>
          )}
        </form>

        <section className={styles.card} aria-label="Overview">
          <div className={styles.hero}>
            <div>
              <div className={styles.heroValue}>{n(d.total)}</div>

              <div className={styles.heroLabel}>
                {hub
                  ? `items currently at ${scopeName}`
                  : "items in total"}
              </div>
            </div>

            <div className={styles.heroSide}>
              {rigView ? (
                <>
                  <div>
                    <strong>{n(d.usable)}</strong>
                    <span>usable rigs</span>
                  </div>

                  <div>
                    <strong>{d.utilization === null ? "—" : `${d.utilization}%`}</strong>
                    <span>
                      utilization ({n(d.outCount)} out of {n(d.usable)} usable)
                    </span>
                  </div>
                </>
              ) : (
                <div>
                  <strong>{n(d.outCount)}</strong>
                  <span>out with someone</span>
                </div>
              )}

              <div>
                <strong>{n(d.lateCards)}</strong>
                <span>late (over {LATE_AFTER_HOURS} hours)</span>
              </div>

              {rigView && (
                <div>
                  <strong>{n(d.waiting)}</strong>
                  <span>
                    waiting to be received
                    {d.oldestWaitingDays !== null && `, oldest ${days(d.oldestWaitingDays)} ago`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Utilization = items in use ÷ usable items. In use = out of the hub: with an FO, IFO, rig team
              or internal person, or sent and not received yet. Usable = every item except lost, damaged
              and retired. Matches dashboard/page.tsx's own definition text, word for word, so the two
              pages never disagree about what this percentage means. */}
          {rigView && d.utilization !== null && (
            <p className={styles.heroNote}>
              Utilization = items in use ÷ usable items. In use = out of the hub: with an FO, IFO, rig team
              or internal person, or sent and not received yet. Usable = every item except lost, damaged and
              retired.
            </p>
          )}

          <div className={styles.tiles}>
            {rigView
              ? [
                  ...RIG_STATES.map((k) => ({
                    key: k,
                    label: RIG_STATE_LABELS[k],
                    value: rigCount[k] ?? 0,
                    href: inventory({ status: RIG_STATE_HREF[k].join(","), type: "rig", ...hubScope }),
                    icon: k === "qc_fail" ? { glyph: "✕", tone: "critical" as const } : undefined,
                  })),
                  {
                    key: "lost",
                    label: "Lost / damaged",
                    value: rigLostCount,
                    href: inventory({ status: "lost,damaged", type: "rig", ...hubScope }),
                    icon: { glyph: "✕", tone: "critical" as const },
                  },
                ].map(({ key, label, value, href, icon }) => (
                  <Link key={key} href={href} className={styles.tile}>
                    <span className={styles.tileLabel}>
                      {icon && (
                        <span className={`${styles.icon} ${TONE[icon.tone]}`} aria-hidden>
                          {icon.glyph}
                        </span>
                      )}

                      {label}
                    </span>

                    <span className={styles.tileValue}>{n(value)}</span>
                  </Link>
                ))
              : simpleTiles
                ? simpleTiles.map(({ key, label, value, href, icon }) => (
                    <Link key={key} href={href} className={styles.tile}>
                      <span className={styles.tileLabel}>
                        {icon && (
                          <span className={`${styles.icon} ${TONE[icon.tone]}`} aria-hidden>
                            {icon.glyph}
                          </span>
                        )}

                        {label}
                      </span>

                      <span className={styles.tileValue}>{n(value)}</span>
                    </Link>
                  ))
                : TILES.map(({ status, icon }) => (
                  <Link
                    key={status}
                    href={inventory({ status, ...hubScope })}
                    className={styles.tile}
                  >
                    <span className={styles.tileLabel}>
                      {icon && (
                        <span
                          className={`${styles.icon} ${TONE[icon.tone]}`}
                          aria-hidden
                        >
                          {icon.glyph}
                        </span>
                      )}

                      {STATUS_LABELS[status]}
                    </span>

                    <span className={styles.tileValue}>
                      {n(byStatusAdjusted[status])}
                    </span>
                  </Link>
                ))}
          </div>
        </section>

        <div className={styles.grid2}>
          <section
            className={styles.card}
            aria-label="Where items are now"
          >
            <h2>Where items are now</h2>

            {(rigView ? rigStatusRows : simpleStatusRows ?? statusRows).length ? (
              <BarList rows={rigView ? rigStatusRows : simpleStatusRows ?? statusRows} />
            ) : (
              <p className={styles.muted}>No items.</p>
            )}
          </section>

          <section
            className={styles.card}
            aria-label="Items moved per day"
          >
            <h2>
              {isYesterday
                ? "Items moved yesterday"
                : "Items moved per day"}
            </h2>

            <ActivityChart days={d.activity} />
          </section>
        </div>

        {!hub && (
          <section className={styles.card} aria-label="Items by hub">
            <h2>Items by hub</h2>

            <p className={styles.muted}>
              Owned is the home hub. Held is where the item is now.
              Net is held minus owned: positive means the hub is
              holding other hubs&apos; items.
            </p>

            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Hub</th>
                    <th className={styles.num}>Owned</th>
                    <th className={styles.num}>Held</th>
                    <th className={styles.num}>In stock</th>
                    <th className={styles.num}>Out</th>
                    <th className={styles.num}>Net</th>
                  </tr>
                </thead>

                <tbody>
                  {d.hubs.map((h) => (
                    <tr key={h.hub_id}>
                      <td>
                        <Link href={inventory({ hub: h.hub_id })}>
                          {h.name}
                        </Link>
                      </td>

                      <td className={styles.num}>{n(h.owned)}</td>
                      <td className={styles.num}>{n(h.held)}</td>
                      <td className={styles.num}>{n(h.inStock)}</td>
                      <td className={styles.num}>{n(h.out)}</td>

                      <td className={styles.num}>
                        {h.held - h.owned > 0 ? "+" : ""}
                        {n(h.held - h.owned)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className={styles.grid2}>
          <section
  className={styles.card}
  aria-label="Who has items"
  style={{ minWidth: 0 }}
>
  <h2>Who has items</h2>

  <div
    className={styles.tableScroll}
    role="region"
    aria-label="Who has items — scrollable table"
    tabIndex={0}
    style={{
      maxHeight: "400px",
      maxWidth: "100%",
      overflowY: "auto",
      overflowX: "auto",
    }}
  >
    <table
      className={styles.table}
      style={{
        width: "100%",
        minWidth: "420px",
        borderCollapse: "separate",
        borderSpacing: 0,
      }}
    >
      <thead>
        <tr>
          <th
            scope="col"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              backgroundColor: "#1e293b",
              color: "#ffffff",
            }}
          >
            Person
          </th>

          <th
            scope="col"
            className={styles.num}
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              backgroundColor: "#1e293b",
              color: "#ffffff",
            }}
          >
            Items
          </th>

          <th
            scope="col"
            className={styles.num}
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              backgroundColor: "#1e293b",
              color: "#ffffff",
            }}
          >
            Oldest
          </th>
        </tr>
      </thead>

      <tbody>
        {/* Display all person rows first. */}
        {d.holders.map((h) => (
          <tr key={h.person_id}>
            <td
              style={{
                whiteSpace: "normal",
                overflowWrap: "anywhere",
              }}
            >
              <Link
                href={inventory({ holder: h.person_id })}
                style={{
                  display: "block",
                  whiteSpace: "normal",
                  overflow: "visible",
                  textOverflow: "clip",
                  overflowWrap: "anywhere",
                  maxWidth: "none",
                }}
              >
                {h.name}
              </Link>

              {h.role && (
                <span
                  className={styles.muted}
                  style={{ display: "block", marginTop: 4 }}
                >
                  {ROLE_LABELS[h.role]}
                </span>
              )}
            </td>

            <td className={styles.num}>{n(h.count)}</td>

            <td className={styles.num}>
              {days(h.oldestDays)}
            </td>
          </tr>
        ))}

        {d.holders.length === 0 && (
          <tr>
            <td colSpan={3} className={styles.muted}>
              Nothing is out right now.
            </td>
          </tr>
        )}

        {/* Grand total is the LAST row — not sticky. */}
        <tr>
          <th
            scope="row"
            style={{
              position: "static",
              textAlign: "left",
              borderTop: "2px solid #64748b",
              backgroundColor: "#1e293b",
              color: "#ffffff",
              fontWeight: 700,
            }}
          >
            Grand total
          </th>

          <td
            className={styles.num}
            style={{
              position: "static",
              borderTop: "2px solid #64748b",
              backgroundColor: "#1e293b",
              color: "#ffffff",
              fontWeight: 700,
            }}
          >
            {n(
              d.holders.reduce(
                (total, holder) => total + holder.count,
                0
              )
            )}
          </td>

          <td
            className={styles.num}
            style={{
              position: "static",
              borderTop: "2px solid #64748b",
              backgroundColor: "#1e293b",
              color: "#ffffff",
              fontWeight: 700,
            }}
          >
            —
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</section>
        </div>

        <section className={styles.card} aria-label="Longest out">
          <h2>Longest out</h2>

          <p className={styles.muted}>
            Items not in stock, oldest first. Days since their last
            recorded movement.
          </p>

          {d.longestOut.length === 0 ? (
            <p className={styles.muted}>Nothing is out right now.</p>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Serial</th>
                    <th>Status</th>
                    <th>Holder</th>
                    <th>Hub</th>
                    <th className={styles.num}>Days out</th>
                  </tr>
                </thead>

                <tbody>
                  {d.longestOut.map((r) => (
                    <tr key={r.item_id}>
                      <td>
                        <Link href={`/inventory/${r.item_id}`}>
                          {r.item_id}
                        </Link>
                      </td>

                      <td>{STATUS_LABELS[r.status]}</td>
                      <td>{r.holder}</td>
                      <td>{r.hub}</td>
                      <td className={styles.num}>{days(r.days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.card} aria-label="Data health">
          <h2>Data health</h2>

          {d.inconsistencies.length === 0 ? (
            <p className={styles.ok}>
              <span
                className={`${styles.icon} ${styles.iconGood}`}
                aria-hidden
              >
                ✓
              </span>{" "}
              Every item with history matches its latest event.
            </p>
          ) : (
            <div>
              <p className={styles.warn}>
                <span
                  className={`${styles.icon} ${styles.iconCritical}`}
                  aria-hidden
                >
                  ✕
                </span>{" "}
                {d.inconsistencies.length} item(s) don&apos;t match
                their latest event. Fix them with a correction on
                the item page.
              </p>

              <ul className={styles.list}>
                {d.inconsistencies.slice(0, 20).map((p) => (
                  <li key={p.item_id}>
                    <Link href={`/inventory/${p.item_id}`}>
                      {p.item_id}
                    </Link>
                    : {p.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.noHistory > 0 && (
            <p className={styles.muted}>
              {n(d.noHistory)} item(s) have no history yet. It starts
              with their first handover or correction.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
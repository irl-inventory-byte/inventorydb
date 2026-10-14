import Link from "next/link";
import type { CSSProperties } from "react";
import { requireRole } from "@/lib/authz";
import { LATE_AFTER_HOURS, computeDashboard } from "@/lib/dashboard";
import { buildHubTree } from "@/lib/hub-tree";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import type { QcCheck, Status } from "@/lib/schema";
import { HANDLER_ROLES, canSeeType, storeFor, typeParam } from "@/lib/access";
import TypeSwitch from "../TypeSwitch";
import { ActivityChart, BarList, n } from "./charts";
import styles from "./dashboard.module.css";
import { HubOrgChart, countHidden } from "./hub-tree-view";
import { Icon, type IconName } from "./icons";
import { SummaryKpis } from "./summary-kpis";

const inventory = (params: Record<string, string>) => `/inventory?${new URLSearchParams(params)}`;
const days = (d: number | null) => (d === null ? "—" : d === 0 ? "today" : `${d}d`);

// One row in the "Needs attention" table.
interface Attention {
  key: string;
  person: string;
  role: string;
  items: number;
  outFor: string; // "14 hours", "3 days", "—"
  issue: string;
  href: string;
  tone: "critical" | "warning" | "info";
}
const GLYPH = { critical: "✕", warning: "▲", info: "●" } as const;
const TONE = { critical: styles.iconCritical, warning: styles.iconWarning, info: styles.iconMuted };

const STATUS_ORDER: Status[] = ["in_stock", "with_fo", "traveling", "with_rig", "with_internal", "with_qc", "with_hardware", "pending", "lost", "damaged", "retired"];
const HUB_BARS = 8;

// Shared styles for dark sticky table headers / footers.
const TH_STYLE: CSSProperties = { position: "sticky", top: 0, zIndex: 2, backgroundColor: "#1e293b", color: "#ffffff" };
const TFOOT_STYLE: CSSProperties = {
  position: "static",
  borderTop: "2px solid #64748b",
  backgroundColor: "#1e293b",
  color: "#ffffff",
  fontWeight: 700,
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireRole();
  const sp = await searchParams;
  // Each login sees only its item types; IM/Admin/FO can switch SD cards / Rigs.
  const type = typeParam(one(sp.type), user.role);
  const store = storeFor(user.role, type);
  // Rig view: the Rigs switch is on, or this login only sees rigs (QC, hardware).
  const rigView = type === "rig" || !canSeeType(user.role, "sd_card");
  const [items, events, people, hubs, qcChecks] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("people"),
    store.list("hubs"),
    rigView ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
  ]);

  const d = computeDashboard(items, events, people, hubs, { hub: "", days: 14, now: new Date() });
  const tree = buildHubTree(hubs, items);
  const showEmpty = one(sp.empty) === "1";
  const hiddenEmpty = countHidden(tree, false);
  const canHandle = HANDLER_ROLES.includes(user.role);
  const activeHubs = hubs.filter((h) => h.active !== "false").length;

  const s = d.byStatus;
  const share = (v: number) => (d.total ? `${Math.round((v / d.total) * 100)}% of all items` : "");
  // Rigs whose latest QC result is Fail (rows are oldest first, so the last one wins).
  const latestQc = new Map<string, string>();
  for (const c of qcChecks) latestQc.set(c.item_id, c.qc_status);
  const hardwareIssues = items.filter((i) => i.item_type === "rig" && latestQc.get(i.item_id) === "fail").length;
  const rigList = (params: Record<string, string>) => inventory({ ...params, type: "rig" });

  type Kpi = { label: string; value: number; hint: string; href: string; icon: IconName; color: string };

  // RIGS: With QC team, With hardware team and Hardware issue instead of With rig team.
  const rigKpis: Kpi[] = [
    { label: "In stock", value: s.in_stock, hint: share(s.in_stock), href: rigList({ status: "in_stock" }), icon: "check", color: "var(--series-3)" },
    { label: "With field officers", value: s.with_fo, hint: share(s.with_fo), href: rigList({ status: "with_fo" }), icon: "user", color: "var(--series-2)" },
    { label: "With QC team", value: s.with_qc, hint: share(s.with_qc), href: rigList({ status: "with_qc" }), icon: "shield", color: "var(--series-7)" },
    { label: "With hardware team", value: s.with_hardware, hint: share(s.with_hardware), href: rigList({ status: "with_hardware" }), icon: "wrench", color: "var(--series-1)" },
    {
      label: "In transit",
      value: s.traveling + s.pending,
      hint: share(s.traveling + s.pending),
      href: rigList({ status: "traveling,pending" }),
      icon: "truck",
      color: "var(--series-4)",
    },
    {
      label: "Hardware issue",
      value: hardwareIssues,
      hint: hardwareIssues ? "Latest QC result is Fail" : "No failed rigs",
      href: "/rigs?qc=fail",
      icon: "alert",
      color: "var(--warning)",
    },
    {
      label: "Lost or damaged",
      value: s.lost + s.damaged,
      hint: share(s.lost + s.damaged),
      href: rigList({ status: "lost,damaged" }),
      icon: "alert",
      color: "var(--critical)",
    },
  ];

  // SD CARDS (and the "All" view): unchanged.
  const sdKpis: Kpi[] = [
    { label: "In stock", value: s.in_stock, hint: share(s.in_stock), href: inventory({ status: "in_stock" }), icon: "check", color: "var(--series-3)" },
    { label: "With field officers", value: s.with_fo, hint: share(s.with_fo), href: inventory({ status: "with_fo" }), icon: "user", color: "var(--series-2)" },
    { label: "With rig team", value: s.with_rig, hint: share(s.with_rig), href: inventory({ status: "with_rig" }), icon: "database", color: "var(--series-7)" },
    { label: "Internal", value: s.with_internal, hint: share(s.with_internal), href: inventory({ status: "with_internal" }), icon: "user", color: "var(--series-1)" },
    {
      label: "In transit",
      value: s.traveling + s.pending,
      hint: share(s.traveling + s.pending),
      href: inventory({ status: "traveling,pending" }),
      icon: "truck",
      color: "var(--series-4)",
    },
    {
      label: "Lost or damaged",
      value: s.lost + s.damaged,
      hint: share(s.lost + s.damaged),
      href: inventory({ status: "lost,damaged" }),
      icon: "alert",
      color: "var(--critical)",
    },
    {
      label: "Retired",
      value: s.retired,
      hint: share(s.retired),
      href: inventory({ status: "retired" }),
      icon: "archive",
      color: "var(--text-muted)",
    },
  ];

  const kpis = rigView ? rigKpis : sdKpis;

  // Bars: one series, one colour. Every bar opens the matching list or hub.
  const statusRows = STATUS_ORDER.filter((st) => s[st] > 0)
    .sort((a, b) => s[b] - s[a])
    .map((st) => ({
      key: st,
      label: STATUS_LABELS[st],
      value: s[st],
      href: inventory({ status: st }),
      tip: `${STATUS_LABELS[st]}\n${n(s[st])} items (${((s[st] / Math.max(1, d.total)) * 100).toFixed(1)}%)`,
    }));

  const byHub = d.hubs.filter((h) => h.held > 0);
  const hubRows = byHub.slice(0, HUB_BARS).map((h) => ({
    key: h.hub_id,
    label: h.name,
    value: h.held,
    href: `/dashboard/hub/${h.hub_id}`,
    tip: `${h.name}\n${n(h.held)} items\n${n(h.byStatus.in_stock)} in stock`,
  }));
  const rest = byHub.slice(HUB_BARS);
  if (rest.length) {
    const total = rest.reduce((sum, h) => sum + h.held, 0);
    hubRows.push({ key: "other", label: `${rest.length} other hubs`, value: total, href: "/inventory", tip: `${rest.length} other hubs\n${n(total)} items` });
  }

  // Needs attention: one row per person (FO, IFO, rig team, IM) or hub holding items for more than
  // LATE_AFTER_HOURS, oldest first, then lost / damaged items. Every name is listed.
  const howLong = (hours: number) => (hours < 48 ? `${Math.floor(hours)} hours` : `${Math.floor(hours / 24)} days`);
  const attention: Attention[] = [];
  const seen = new Set<string>();

  for (const g of d.late) {
    seen.add(g.key);
    if (g.kind === "pending") {
      attention.push({
        key: `late-pending-${g.key}`,
        person: g.label,
        role: "Hub",
        items: g.count,
        outFor: howLong(g.oldestHours),
        issue: "Sent, not received",
        href: `/handover/receive?${new URLSearchParams({ hub: g.key })}`,
        tone: "warning",
      });
    } else {
      attention.push({
        key: `late-${g.kind}-${g.key}`,
        person: g.label,
        role: g.kind === "fo" ? "FO" : "IFO",
        items: g.count,
        outFor: howLong(g.oldestHours),
        issue: g.kind === "fo" ? "Not returned" : "Not arrived",
        href: inventory({ holder: g.key, status: g.kind === "fo" ? "with_fo" : "traveling" }),
        tone: "warning",
      });
    }
  }

  // Rig team and IM are not part of d.late, so take them from the holders list (held for 1 day or more).
  for (const h of d.holders) {
    if (!h.role || (h.role !== "rig" && h.role !== "im") || seen.has(h.person_id)) continue;
    if (h.oldestDays === null || h.oldestDays < 1) continue;
    attention.push({
      key: `late-${h.role}-${h.person_id}`,
      person: h.name,
      role: ROLE_LABELS[h.role],
      items: h.count,
      outFor: `${h.oldestDays} day${h.oldestDays === 1 ? "" : "s"}`,
      issue: "Not returned",
      href: inventory({ holder: h.person_id, status: h.role === "rig" ? "with_rig" : "with_internal" }),
      tone: "warning",
    });
  }

  if (s.lost > 0) {
    attention.push({ key: "lost", person: "—", role: "—", items: s.lost, outFor: "—", issue: "Lost", href: inventory({ status: "lost" }), tone: "critical" });
  }
  if (s.damaged > 0) {
    attention.push({ key: "damaged", person: "—", role: "—", items: s.damaged, outFor: "—", issue: "Damaged", href: inventory({ status: "damaged" }), tone: "critical" });
  }

  const holdersTotal = d.holders.reduce((total, holder) => total + holder.count, 0);

  return (
    <div className={styles.root}>
      <main className={styles.wrap}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>
              <Icon name="layers" size={26} />
            </span>
            <div>
              <h1>Inventory Dashboard</h1>
              <p className={styles.subtitle}>
                {n(d.total)} items · {activeHubs} hubs · the latest known position of every item
              </p>
            </div>
          </div>
          <div className={styles.actions}>
            {canHandle && (
              <>
                <Link href="/handover/send" className={`${styles.btn} ${styles.btnPrimary}`}>
                  <Icon name="send" size={16} /> Send items
                </Link>
                <Link href="/handover/receive" className={styles.btn}>
                  <Icon name="inbox" size={16} /> Receive items
                </Link>
              </>
            )}
            <Link href="/dashboard" className={styles.btn} title="Reload the latest numbers">
              <Icon name="refresh" size={16} /> Refresh
            </Link>
          </div>
        </div>

        <nav className={styles.tabs} aria-label="Sections">
          <span className={`${styles.tab} ${styles.tabOn}`} aria-current="page">
            Overview
          </span>
          <Link href="/dashboard/analytics" className={styles.tab}>
            Analytics
          </Link>
          <Link href="/inventory" className={styles.tab}>
            Inventory
          </Link>
          <Link href="/handover/receipts" className={styles.tab}>
            Receipts
          </Link>
          {user.role === "admin" && (
            <Link href="/admin/hubs" className={styles.tab}>
              Hubs
            </Link>
          )}
          <Link href="/" className={styles.tab}>
            Home
          </Link>
        </nav>

        <form action="/inventory" method="get" role="search" className={styles.search}>
          <Icon name="search" size={18} />
          <input name="q" placeholder="Find an item by serial, prism no., brand or model" aria-label="Find an item" />
        </form>

        <TypeSwitch role={user.role} current={type} path="/dashboard" />

        <SummaryKpis d={d} items={items} rigView={rigView} />

        <section className={styles.kpiGrid} aria-label="Overview">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className={styles.kpi} style={{ "--kpi": k.color } as CSSProperties}>
              <span className={styles.kpiIcon}>
                <Icon name={k.icon} size={22} />
              </span>
              <span className={styles.kpiBody}>
                <span className={styles.kpiLabel}>{k.label}</span>
                <span className={styles.kpiValue}>{n(k.value)}</span>
                {k.hint && <span className={styles.kpiHint}>{k.hint}</span>}
              </span>
            </Link>
          ))}
        </section>

        <section className={styles.card} aria-label="Hub hierarchy">
          <div className={styles.sectionHead}>
            <h2>Hub hierarchy</h2>
            <span className={styles.muted}>Click a hub for everything about it</span>
          </div>
          <p className={styles.muted}>
            The main hub is at the top with the hubs under it. Each box shows the items the hub holds, including the
            hubs under it.
          </p>
          <HubOrgChart roots={tree} showEmpty={showEmpty} />
          {hiddenEmpty > 0 && !showEmpty && (
            <p className={styles.muted}>
              {hiddenEmpty} hub{hiddenEmpty === 1 ? "" : "s"} with no items {hiddenEmpty === 1 ? "is" : "are"} hidden.{" "}
              <Link href="/dashboard?empty=1" className={styles.link}>
                Show {hiddenEmpty === 1 ? "it" : "them"}
              </Link>
            </p>
          )}
          {showEmpty && (
            <p className={styles.muted}>
              <Link href="/dashboard" className={styles.link}>
                Hide hubs with no items
              </Link>
            </p>
          )}
        </section>

        <div className={styles.chartRow}>
          <section className={styles.card} aria-label="Items by status">
            <h2>Items by status</h2>
            {statusRows.length ? <BarList rows={statusRows} /> : <p className={styles.muted}>No items.</p>}
          </section>
          <section className={styles.card} aria-label="Items by hub">
            <h2>Items by hub</h2>
            {hubRows.length ? <BarList rows={hubRows} /> : <p className={styles.muted}>No items at any hub.</p>}
          </section>
        </div>

        <section className={styles.card} aria-label="Items moved per day">
          <div className={styles.sectionHead}>
            <h2>Items moved per day</h2>
            <span className={styles.muted}>Last 14 days</span>
          </div>
          <ActivityChart days={d.activity} />
        </section>

        <div className={styles.grid2}>
          {/* NEEDS ATTENTION — table */}
          <section className={styles.card} id="attention" aria-label="Needs attention" style={{ minWidth: 0 }}>
            <h2>Needs attention</h2>
            <p className={styles.muted}>
              FO, IFO, rig team, IM or hubs holding items for more than {LATE_AFTER_HOURS} hours, plus lost and
              damaged items.
            </p>

            {attention.length === 0 ? (
              <p className={styles.ok}>
                <span className={`${styles.icon} ${styles.iconGood}`} aria-hidden>
                  ✓
                </span>{" "}
                Nothing needs attention right now.
              </p>
            ) : (
              <div
                className={styles.tableScroll}
                role="region"
                aria-label="Needs attention — scrollable table"
                tabIndex={0}
                style={{ maxHeight: "400px", maxWidth: "100%", overflowY: "auto", overflowX: "auto" }}
              >
                <table
                  className={styles.table}
                  style={{ width: "100%", minWidth: "520px", borderCollapse: "separate", borderSpacing: 0 }}
                >
                  <thead>
                    <tr>
                      <th scope="col" style={TH_STYLE}>
                        Person
                      </th>
                      <th scope="col" style={TH_STYLE}>
                        Role
                      </th>
                      <th scope="col" className={styles.num} style={TH_STYLE}>
                        Items
                      </th>
                      <th scope="col" style={TH_STYLE}>
                        Out for
                      </th>
                      <th scope="col" style={TH_STYLE}>
                        Issue
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {attention.map((a) => (
                      <tr key={a.key}>
                        <td style={{ whiteSpace: "normal", overflow: "visible", overflowWrap: "anywhere" }}>
                          <Link
                            href={a.href}
                            style={{
                              display: "block",
                              whiteSpace: "normal",
                              overflow: "visible",
                              textOverflow: "clip",
                              overflowWrap: "anywhere",
                              maxWidth: "none",
                            }}
                          >
                            {a.person}
                          </Link>
                        </td>
                        <td>{a.role}</td>
                        <td className={styles.num}>{a.items ? n(a.items) : "—"}</td>
                        <td>{a.outFor}</td>
                        <td>
                          <span className={`${styles.icon} ${TONE[a.tone]}`} aria-hidden>
                            {GLYPH[a.tone]}
                          </span>{" "}
                          {a.issue}
                        </td>
                      </tr>
                    ))}
                  </tbody>

                  <tfoot style={{ position: "static" }}>
                    <tr>
                      <th scope="row" colSpan={2} style={{ ...TFOOT_STYLE, textAlign: "left" }}>
                        Total
                      </th>
                      <td className={styles.num} style={TFOOT_STYLE}>
                        {n(attention.reduce((total, a) => total + a.items, 0))}
                      </td>
                      <td style={TFOOT_STYLE}>—</td>
                      <td style={TFOOT_STYLE}>
                        {attention.length} row{attention.length === 1 ? "" : "s"}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* WHO HAS ITEMS */}
          <section className={styles.card} aria-label="Who has items" style={{ minWidth: 0 }}>
            <h2>Who has items</h2>

            <div
              className={styles.tableScroll}
              role="region"
              aria-label="Who has items — scrollable table"
              tabIndex={0}
              style={{ maxHeight: "400px", maxWidth: "100%", overflowY: "auto", overflowX: "auto" }}
            >
              <table
                className={styles.table}
                style={{ width: "100%", minWidth: "420px", borderCollapse: "separate", borderSpacing: 0 }}
              >
                <thead>
                  <tr>
                    <th scope="col" style={TH_STYLE}>
                      Person
                    </th>
                    <th scope="col" className={styles.num} style={TH_STYLE}>
                      Items
                    </th>
                    <th scope="col" className={styles.num} style={TH_STYLE}>
                      Longest
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {d.holders.length === 0 ? (
                    <tr>
                      <td colSpan={3} className={styles.muted}>
                        Nothing is out right now.
                      </td>
                    </tr>
                  ) : (
                    d.holders.map((h) => (
                      <tr key={h.person_id}>
                        <td style={{ whiteSpace: "normal", overflow: "visible", overflowWrap: "anywhere" }}>
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
                            <span className={styles.muted} style={{ display: "block", marginTop: 4 }}>
                              {ROLE_LABELS[h.role]}
                            </span>
                          )}
                        </td>

                        <td className={styles.num}>{n(h.count)}</td>

                        <td className={styles.num}>{days(h.oldestDays)}</td>
                      </tr>
                    ))
                  )}
                </tbody>

                <tfoot style={{ position: "static" }}>
                  <tr>
                    <th scope="row" style={{ ...TFOOT_STYLE, textAlign: "left" }}>
                      Grand total
                    </th>
                    <td className={styles.num} style={TFOOT_STYLE}>
                      {n(holdersTotal)}
                    </td>
                    <td className={styles.num} style={TFOOT_STYLE}>
                      —
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>

        <p className={styles.muted}>
          <Link href="/dashboard/analytics" className={styles.link}>
            More analytics
          </Link>{" "}
          — hub owned vs held, longest out, data health.
        </p>
      </main>
    </div>
  );
}
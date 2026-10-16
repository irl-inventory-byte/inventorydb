import Link from "next/link";
import type { CSSProperties } from "react";
import { requireRole } from "@/lib/authz";
import { LATE_AFTER_HOURS, computeDashboard } from "@/lib/dashboard";
import { buildHubTree } from "@/lib/hub-tree";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import type { QcCheck, Status } from "@/lib/schema";
import { HANDLER_ROLES, INVENTORY_ROLES, canSeeType, storeFor, typeParam } from "@/lib/access";
import TypeSwitch from "../TypeSwitch";
import { ActivityChart, BarList, n } from "./charts";
import styles from "./dashboard.module.css";
import { HubOrgChart, countHidden } from "./hub-tree-view";
import AttentionFilter from "./attentionfilter";
import { Icon, type IconName } from "./icons";
import { SummaryKpis } from "./summary-kpis";
import { RIG_STATES, RIG_STATE_LABELS, qcPerformance, rigState, type RigState } from "@/lib/rig-state";

const inventory = (params: Record<string, string>) => `/inventory?${new URLSearchParams(params)}`;
const days = (d: number | null) => (d === null ? "—" : d === 0 ? "today" : `${d}d`);

// One row in the "Needs attention" table.
interface Attention {
  key: string;
  person: string;
  role: string;
  city: string; // city of the hub(s) where the items are, e.g. "Bangalore" or "Bangalore, Pune"
  sentBy: string; // who handed these items over, e.g. "Ravi Kumar" or "Ravi Kumar (20), Anita (6)"
  items: number;
  hours: number | null; // how long the oldest item has been out, for sorting longest first; null for lost / damaged
  outFor: string; // "14 hours", "3 days", "—"
  issue: string;
  href: string;
  tone: "critical" | "warning" | "info";
}
const GLYPH = { critical: "✕", warning: "▲", info: "●" } as const;
const TONE = { critical: styles.iconCritical, warning: styles.iconWarning, info: styles.iconMuted };

const STATUS_ORDER: Status[] = ["in_stock", "with_fo", "traveling", "with_rig", "with_internal", "pending_qc", "with_qc", "pending_hardware", "with_hardware", "pending", "lost", "damaged", "retired"];
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
  // QC team performance shows whenever rigs are in view (All or Rigs).
  const showQc = canSeeType(user.role, "rig") && type !== "sd_card";
  const [items, events, people, hubs, qcChecks] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("people"),
    store.list("hubs"),
    showQc ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
  ]);

  const d = computeDashboard(items, events, people, hubs, { hub: "", days: 14, now: new Date() });
  const tree = buildHubTree(hubs, items);
  const showEmpty = one(sp.empty) === "1";
  const hiddenEmpty = countHidden(tree, false);
  const canHandle = HANDLER_ROLES.includes(user.role);
  const activeHubs = hubs.filter((h) => h.active !== "false").length;

  const s = d.byStatus;
  const share = (v: number) => (d.total ? `${Math.round((v / d.total) * 100)}% of all items` : "");
  // Latest QC result per rig (rows are oldest first, so the last one wins).
  const latestQc = new Map<string, string>();
  for (const c of qcChecks) latestQc.set(c.item_id, c.qc_status);
  const qcTeam = qcPerformance(qcChecks, 2);

  type Kpi = { label: string; value: number; hint: string; href: string; icon: IconName; color: string };

  // RIGS: one tile per rig state (see RIG_STATES in lib/rig-state.ts). Each opens Rig checks filtered to it.
  const rigCount = Object.fromEntries(RIG_STATES.map((k) => [k, 0])) as Record<RigState, number>;
  // QC passed tile: who passed those rigs (the QC person on each rig's latest result).
  const latestQcBy = new Map<string, string>();
  for (const c of qcChecks) latestQcBy.set(c.item_id, c.recorded_by_name || c.recorded_by);
  const passedBy = new Map<string, number>();
  for (const i of items) {
    if (i.item_type !== "rig") continue;
    const st = rigState(i.status, latestQc.get(i.item_id));
    rigCount[st] = (rigCount[st] ?? 0) + 1;
    if (st === "qc_pass") {
      const who = latestQcBy.get(i.item_id) || "QC team";
      passedBy.set(who, (passedBy.get(who) ?? 0) + 1);
    }
  }
  const passedFrom = [...passedBy.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const passedFromText = passedFrom.length
    ? `From ${passedFrom.slice(0, 2).map(([who, c]) => `${who} (${c})`).join(", ")}${passedFrom.length > 2 ? ` +${passedFrom.length - 2} more` : ""}`
    : "";
  const rigTotal = items.filter((i) => i.item_type === "rig").length;
  const rigShare = (v: number) => (rigTotal ? `${Math.round((v / rigTotal) * 100)}% of all rigs` : "");
  const RIG_TILE: Record<(typeof RIG_STATES)[number], { icon: IconName; color: string; hint?: string }> = {
    in_stock: { icon: "check", color: "var(--series-3)", hint: "With the IM" },
    hardware: { icon: "wrench", color: "var(--series-1)", hint: "Received by hardware" },
    internal: { icon: "user", color: "var(--series-7)", hint: "Checked out to internal people" },
    fo: { icon: "user", color: "var(--series-2)", hint: "Checked out to an FO" },
    transit: { icon: "truck", color: "var(--series-4)", hint: "Sent by the IM to an IFO" },
    qc_pending: { icon: "shield", color: "var(--series-7)", hint: "Received by QC" },
    qc_pass: { icon: "check", color: "var(--series-3)", hint: "Passed by QC, sent to IM, not received yet" },
    qc_fail: { icon: "alert", color: "var(--warning)", hint: "Hardware has not received it yet" },
    rtd: { icon: "send", color: "var(--series-3)", hint: "Repaired, received by IM" },
    dead: { icon: "archive", color: "var(--text-muted)", hint: "Declared dead by hardware" },
  };
  const rigKpis: Kpi[] = RIG_STATES.map((k) => ({
    label: RIG_STATE_LABELS[k],
    value: rigCount[k],
    hint: k === "qc_pass" && passedFromText ? passedFromText : rigCount[k] ? rigShare(rigCount[k]) : (RIG_TILE[k].hint ?? ""),
    href: `/rigs?state=${k}`,
    icon: RIG_TILE[k].icon,
    color: RIG_TILE[k].color,
  }));

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

  // City of a hub (its City column, or its name when City is blank), and the cities where a person's items are.
  const hubCity = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));
  const holderCities = new Map<string, Set<string>>();
  for (const i of items) {
    if (!i.current_holder || i.status === "in_stock") continue;
    const set = holderCities.get(i.current_holder) ?? new Set<string>();
    set.add(hubCity.get(i.current_hub) ?? i.current_hub);
    holderCities.set(i.current_holder, set);
  }
  const personHub = new Map(people.map((p) => [p.person_id, p.hub]));

  // Who sent the items: the sender on each item's latest handover. Several senders → the most items first.
  const eventById = new Map(events.map((e) => [e.event_id, e]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));
  const senders = (list: typeof items) => {
    const count = new Map<string, number>();
    for (const i of list) {
      const e = eventById.get(i.last_event_id);
      const who = (e?.from_person || personName.get(e?.from_id ?? "") || e?.from_id || "").trim();
      if (who) count.set(who, (count.get(who) ?? 0) + 1);
    }
    const sorted = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (sorted.length === 0) return "—";
    if (sorted.length === 1) return sorted[0][0];
    const shown = sorted.slice(0, 3).map(([who, c]) => `${who} (${c})`).join(", ");
    return sorted.length > 3 ? `${shown} +${sorted.length - 3} more` : shown;
  };
  const sentToPerson = (id: string) => senders(items.filter((i) => i.current_holder === id && i.status !== "in_stock"));
  const sentToHub = (hubId: string) => senders(items.filter((i) => i.status === "pending" && i.current_hub === hubId));
  const cityOfPerson = (id: string) => {
    const set = holderCities.get(id);
    if (set && set.size) return [...set].filter(Boolean).sort().join(", ");
    const hub = personHub.get(id);
    return hub ? (hubCity.get(hub) ?? hub) : "—";
  };

  for (const g of d.late) {
    seen.add(g.key);
    if (g.kind === "pending") {
      attention.push({
        key: `late-pending-${g.key}`,
        person: g.label,
        role: "Hub",
        city: hubCity.get(g.key) ?? g.key,
        sentBy: sentToHub(g.key),
        items: g.count,
        hours: g.oldestHours,
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
        city: cityOfPerson(g.key),
        sentBy: sentToPerson(g.key),
        items: g.count,
        hours: g.oldestHours,
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
      city: cityOfPerson(h.person_id),
      sentBy: sentToPerson(h.person_id),
      items: h.count,
      hours: h.oldestDays * 24,
      outFor: `${h.oldestDays} day${h.oldestDays === 1 ? "" : "s"}`,
      issue: "Not returned",
      href: inventory({ holder: h.person_id, status: h.role === "rig" ? "with_rig" : "with_internal" }),
      tone: "warning",
    });
  }

  if (s.lost > 0) {
    attention.push({ key: "lost", person: "—", role: "—", city: "—", sentBy: "—", items: s.lost, hours: null, outFor: "—", issue: "Lost", href: inventory({ status: "lost" }), tone: "critical" });
  }
  if (s.damaged > 0) {
    attention.push({ key: "damaged", person: "—", role: "—", city: "—", sentBy: "—", items: s.damaged, hours: null, outFor: "—", issue: "Damaged", href: inventory({ status: "damaged" }), tone: "critical" });
  }

  // Longest out first. Lost / damaged rows have no time, so they go last.
  attention.sort((a, b) => (b.hours ?? -1) - (a.hours ?? -1) || b.items - a.items);

  // Filter by cities and roles. A row with items in several cities matches if any of them is chosen.
  const splitCities = (c: string) => c.split(",").map((x) => x.trim()).filter((x) => x && x !== "—");
  const cityOptions = [...new Set(attention.flatMap((a) => splitCities(a.city)))].sort((a, b) => a.localeCompare(b));
  const roleOptions = [...new Set(attention.map((a) => a.role).filter((r) => r && r !== "—"))].sort((a, b) => a.localeCompare(b));
  // Several values allowed, comma separated: ?acity=Bangalore,Pune&arole=FO,IFO
  const listParam = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);
  const cityFilter = listParam(one(sp.acity));
  const roleFilter = listParam(one(sp.arole));
  const shownAttention = attention.filter(
    (a) =>
      (cityFilter.length === 0 || splitCities(a.city).some((c) => cityFilter.includes(c))) &&
      (roleFilter.length === 0 || roleFilter.includes(a.role)),
  );
  const keepParams: Record<string, string> = {};
  if (one(sp.type)) keepParams.type = one(sp.type);
  if (showEmpty) keepParams.empty = "1";

  // Who has items: longest out first, then most items.
  const holdersSorted = [...d.holders].sort(
    (a, b) => (b.oldestDays ?? -1) - (a.oldestDays ?? -1) || b.count - a.count || a.name.localeCompare(b.name),
  );
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
          {INVENTORY_ROLES.includes(user.role) && (
            <Link href="/inventory" className={styles.tab}>
              Inventory
            </Link>
          )}
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

        <section className={rigView ? `${styles.kpiGrid} ${styles.kpiGridRig}` : styles.kpiGrid} aria-label="Overview">
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

        {showQc && (
          <section className={styles.card} aria-label="QC team performance">
            <div className={styles.sectionHead}>
              <h2>QC team performance</h2>
              <span className={styles.muted}>Pass and Fail recorded by each QC person</span>
            </div>
            {qcTeam.length === 0 ? (
              <p className={styles.muted}>No QC results recorded yet.</p>
            ) : (
              <div className={styles.tableScroll} role="region" aria-label="QC team performance table" tabIndex={0} style={{ overflowX: "auto" }}>
                <table className={styles.table} style={{ width: "100%", minWidth: "560px" }}>
                  <thead>
                    <tr>
                      <th scope="col">QC person</th>
                      <th scope="col" style={{ textAlign: "right" }}>Checked</th>
                      <th scope="col" style={{ textAlign: "right" }}>Pass</th>
                      <th scope="col" style={{ textAlign: "right" }}>Fail</th>
                      <th scope="col" style={{ textAlign: "right" }}>Passed, then failed within 2 days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qcTeam.map((q) => (
                      <tr key={q.key}>
                        <td>{q.name}</td>
                        <td style={{ textAlign: "right" }}>{n(q.checked)}</td>
                        <td style={{ textAlign: "right", color: "#15803D", fontWeight: 600 }}>{n(q.pass)}</td>
                        <td style={{ textAlign: "right", color: "#B42318", fontWeight: 600 }}>{n(q.fail)}</td>
                        <td style={{ textAlign: "right", fontWeight: q.passFailedSoon ? 700 : 400, color: q.passFailedSoon ? "#B42318" : undefined }}>
                          {n(q.passFailedSoon)}
                          {q.pass > 0 && ` (${Math.round((q.passFailedSoon / q.pass) * 100)}% of passes)`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={styles.muted}>
              &quot;Passed, then failed within 2 days&quot; = a rig this person passed that got a Fail result within 48
              hours of that pass.
            </p>
          </section>
        )}

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

        <div style={{ display: "grid", gap: 20 }}>
          {/* NEEDS ATTENTION — table (full width, so every column shows) */}
          <section className={styles.card} id="attention" aria-label="Needs attention" style={{ minWidth: 0 }}>
            <h2>Needs attention</h2>
            <p className={styles.muted}>
              FO, IFO, rig team, IM or hubs holding items for more than {LATE_AFTER_HOURS} hours, plus lost and
              damaged items, with who sent them. Longest out first.
            </p>

            {attention.length > 0 && (
              <AttentionFilter cities={cityOptions} roles={roleOptions} city={cityFilter} role={roleFilter} keep={keepParams} />
            )}

            {attention.length > 0 && shownAttention.length === 0 ? (
              <p className={styles.muted}>Nothing matches this filter.</p>
            ) : attention.length === 0 ? (
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
                style={{ maxHeight: "560px", maxWidth: "100%", overflowY: "auto", overflowX: "auto" }}
              >
                <table
                  className={styles.table}
                  style={{ width: "100%", minWidth: "860px", borderCollapse: "separate", borderSpacing: 0 }}
                >
                  <thead>
                    <tr>
                      <th scope="col" style={TH_STYLE}>
                        Person
                      </th>
                      <th scope="col" style={TH_STYLE}>
                        Role
                      </th>
                      <th scope="col" style={TH_STYLE}>
                        City
                      </th>
                      <th scope="col" style={TH_STYLE}>
                        Sent by
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
                    {shownAttention.map((a) => (
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
                        <td style={{ whiteSpace: "normal", minWidth: 140 }}>{a.city}</td>
                        <td style={{ whiteSpace: "normal", minWidth: 160 }}>{a.sentBy}</td>
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
                      <th scope="row" colSpan={4} style={{ ...TFOOT_STYLE, textAlign: "left" }}>
                        Total
                      </th>
                      <td className={styles.num} style={TFOOT_STYLE}>
                        {n(shownAttention.reduce((total, a) => total + a.items, 0))}
                      </td>
                      <td style={TFOOT_STYLE}>—</td>
                      <td style={TFOOT_STYLE}>
                        {shownAttention.length} row{shownAttention.length === 1 ? "" : "s"}
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
              style={{ maxHeight: "560px", maxWidth: "100%", overflowY: "auto", overflowX: "auto" }}
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
                    holdersSorted.map((h) => (
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
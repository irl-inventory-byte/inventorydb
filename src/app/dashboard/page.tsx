import Link from "next/link";
import type { CSSProperties } from "react";
import { requireRole } from "@/lib/authz";
import { LATE_AFTER_HOURS, computeDashboard } from "@/lib/dashboard";
import { buildHubTree } from "@/lib/hub-tree";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import type { HardwareUpdate, QcCheck, Status } from "@/lib/schema";
import { HANDLER_ROLES, INVENTORY_ROLES, allowedTypes, canSeeType, storeFor, typeParam } from "@/lib/access";
import TypeSwitch from "../TypeSwitch";
import RoleSwitch from "../RoleSwitch";
import { BarList, n, type BarRow } from "./charts";
import { DailyMoves } from "./daily-moves";
import { dailyMoves, moveFilterOptions, pickRange } from "@/lib/daily-moves";
import { formatIst, istDate } from "@/lib/time";
import styles from "./dashboard.module.css";
import { HubOrgChart, countHidden } from "./hub-tree-view";
import AttentionFilter from "./attentionfilter";
import { Icon, type IconName } from "./icons";
import { SummaryKpis } from "./summary-kpis";
import { RIG_STATES, RIG_STATE_LABELS, rigState, type RigState } from "@/lib/rig-state";
import { inactiveRigs } from "@/lib/rig-metrics";
import { NO_ACTIVITY_DAYS, RigMetrics } from "./rig-metrics";
import type { Item } from "@/lib/schema";

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
  late?: Item[]; // the delayed items behind this row (out for more than LATE_AFTER_HOURS), shown when the row is opened
}
const GLYPH = { critical: "✕", warning: "▲", info: "●" } as const;
const TONE = { critical: styles.iconCritical, warning: styles.iconWarning, info: styles.iconMuted };

const STATUS_ORDER: Status[] = ["in_stock", "with_fo", "traveling", "with_rig", "with_internal", "pending_qc", "with_qc", "pending_hardware", "with_hardware", "pending", "lost", "damaged", "retired", "rnd"];
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

/* ------------------------------------------------------------------ */
/* MOBILES: the parts only the Mobile dashboard has                     */
/* ------------------------------------------------------------------ */

const TOP = 8;

/** A mobile's saved details (Asset Tag, Serial, Model No., Category, Storage). */
function details(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]));
    }
  } catch {
    // no details
  }
  return {};
}

const mobileList = (params: Record<string, string> = {}) => `/inventory?${new URLSearchParams({ type: "mobile", ...params })}`;

/** Count mobiles by a label, biggest first; the rest are summed into one "other" bar. */
function bars(items: Item[], labelOf: (i: Item) => string, what: string, href: (label: string) => string): BarRow[] {
  const count = new Map<string, number>();
  for (const i of items) {
    const label = labelOf(i).trim() || "Not set";
    count.set(label, (count.get(label) ?? 0) + 1);
  }
  const sorted = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rows: BarRow[] = sorted.slice(0, TOP).map(([label, value]) => ({
    key: label,
    label,
    value,
    href: href(label),
    tip: `${label}\n${n(value)} ${value === 1 ? "mobile" : "mobiles"}`,
  }));
  const rest = sorted.slice(TOP);
  if (rest.length) {
    const value = rest.reduce((s, [, v]) => s + v, 0);
    rows.push({ key: "other", label: `${rest.length} other ${what}`, value, href: mobileList(), tip: `${rest.length} other ${what}\n${n(value)} mobiles` });
  }
  return rows;
}

/**
 * Dashboard → Mobile, the charts only mobiles have: by category, manufacturer, model and storage. The rest of the
 * page (status tiles, hub hierarchy, moved per day, needs attention, who has items) is the same as for SD cards.
 */
function MobileCharts({ items }: { items: Item[] }) {
  const byCategory = bars(items, (i) => details(i.attributes)["Category"] ?? "", "categories", (l) => mobileList({ q: l }));
  const byMaker = bars(items, (i) => i.brand, "manufacturers", (l) => mobileList({ q: l }));
  const byModel = bars(items, (i) => i.model, "models", (l) => mobileList({ q: l }));
  const byStorage = bars(items, (i) => details(i.attributes)["Storage"] ?? "", "sizes", (l) => mobileList({ q: l }));

  return (
    <>
      {items.length === 0 ? (
        <section className={styles.card}>
          <p className={styles.muted}>
            No mobiles yet. An Admin or IM adds them in Inventory → Mobile → + Add a mobile, by scanning the phone&apos;s
            QR code (IMEI).
          </p>
        </section>
      ) : (
        <>
          <div className={styles.chartRow}>
            <section className={styles.card} aria-label="Mobiles by category">
              <h2>By category</h2>
              <BarList rows={byCategory} />
            </section>
            <section className={styles.card} aria-label="Mobiles by manufacturer">
              <h2>By manufacturer</h2>
              <BarList rows={byMaker} />
            </section>
          </div>
          <div className={styles.chartRow}>
            <section className={styles.card} aria-label="Mobiles by model">
              <h2>By model</h2>
              <BarList rows={byModel} />
            </section>
            <section className={styles.card} aria-label="Mobiles by storage">
              <h2>By storage</h2>
              <BarList rows={byStorage} />
            </section>
          </div>
        </>
      )}

      <p className={styles.muted}>
        <Link href={mobileList()} className={styles.link}>
          See every mobile in Inventory
        </Link>{" "}
        — IMEI, Asset Tag, Serial, Model, Category, Storage and Cost.
      </p>
    </>
  );
}
export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const user = await requireRole();
  const sp = await searchParams;
  // Each login sees only its item types; IM/Admin/FO can switch SD cards / Rigs. There is no "All items"
  // view on the dashboard: with no choice yet it opens on the first type this login can see (SD cards).
  const type = typeParam(one(sp.type), user.role) || allowedTypes(user.role)[0] || "";
  const store = storeFor(user.role, type);
  // Rig view: the Rigs switch is on, or this login only sees rigs (QC, hardware).
  const rigView = type === "rig" || !canSeeType(user.role, "sd_card");
  // QC team performance shows whenever rigs are in view (All or Rigs).
  // Mobile view: tiles and breakdowns only (mobiles are not sent or received).
  const mobileView = type === "mobile";
  const showQc = canSeeType(user.role, "rig") && type !== "sd_card" && !mobileView;
  const [items, events, people, hubs, qcChecks, hardwareUpdates] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("people"),
    store.list("hubs"),
    showQc ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
    showQc ? store.list("hardware_updates") : Promise.resolve([] as HardwareUpdate[]),
  ]);
  const now = new Date();

  const d = computeDashboard(items, events, people, hubs, { hub: "", days: 14, now });
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
    qc_pass: { icon: "check", color: "var(--series-3)", hint: "Passed by QC or repaired by hardware, sent to IM, not received yet" },
    qc_fail: { icon: "alert", color: "var(--warning)", hint: "Hardware has not received it yet" },
    rtd: { icon: "send", color: "var(--series-3)", hint: "Repaired, received by IM" },
    dead: { icon: "archive", color: "var(--text-muted)", hint: "Declared dead by hardware" },
    rnd: { icon: "wrench", color: "var(--series-7)", hint: "Moved to R&D by hardware" },
  };
  const rigKpis: Kpi[] = RIG_STATES.map((k) => ({
    label: RIG_STATE_LABELS[k],
    value: rigCount[k],
    hint: k === "qc_pass" && passedFromText ? passedFromText : rigCount[k] ? rigShare(rigCount[k]) : (RIG_TILE[k].hint ?? ""),
    href: `/rigs?state=${k}`,
    icon: RIG_TILE[k].icon,
    color: RIG_TILE[k].color,
  }));
  // Unknown: rigs with no handover, QC result or hardware update for more than NO_ACTIVITY_DAYS days
  // (with hardware, dead, R&D, lost and damaged rigs are left out). It overlaps the tiles above.
  const unknownRigs = showQc ? inactiveRigs(items, events, qcChecks, hardwareUpdates, now, NO_ACTIVITY_DAYS) : [];
  // Admin only: every rig sent and not received yet (to IMs, QC or hardware), and every rig the hardware team
  // has (received or still on its way to them).
  if (user.role === "admin") {
    const rigsOnly = items.filter((i) => i.item_type === "rig");
    const toIm = rigsOnly.filter((i) => i.status === "pending").length;
    const toQc = rigsOnly.filter((i) => i.status === "pending_qc").length;
    const toHw = rigsOnly.filter((i) => i.status === "pending_hardware").length;
    const atHw = rigsOnly.filter((i) => i.status === "with_hardware").length;
    rigKpis.push(
      {
        label: "To be received",
        value: toIm + toQc + toHw,
        hint: `${toIm} to IMs · ${toQc} to QC · ${toHw} to hardware`,
        href: inventory({ type: "rig", status: "pending,pending_qc,pending_hardware" }),
        icon: "inbox",
        color: "var(--series-4)",
      },
      {
        label: "Hardware team (all)",
        value: atHw + toHw,
        hint: `${atHw} received · ${toHw} not received yet`,
        href: inventory({ type: "rig", status: "with_hardware,pending_hardware" }),
        icon: "wrench",
        color: "var(--series-1)",
      },
    );
  }
  rigKpis.push({
    label: "Unknown",
    value: unknownRigs.length,
    hint: `No activity for ${NO_ACTIVITY_DAYS}+ days`,
    href: "/rigs?state=unknown",
    icon: "alert",
    color: "var(--critical)",
  });

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

  // Mobiles: the SD card tiles, without the rig team and internal ones (mobiles go only to IMs, FOs and IFOs),
  // and every tile opens the Mobile list.
  // Six even tiles (3 + 3): Total, In stock, With field officers, In transit, Lost or damaged, Retired.
  const mobileKpis: Kpi[] = [
    {
      label: "Total mobiles",
      value: d.total,
      hint: `${n(d.outCount)} in use · ${n(d.usable)} usable`,
      href: mobileList(),
      icon: "layers",
      color: "var(--series-1)",
    },
    ...sdKpis
      .filter((k) => k.label !== "With rig team" && k.label !== "Internal")
      .map((k) => ({ ...k, href: `${k.href}&type=mobile`, hint: k.hint.replace("of all items", "of all mobiles") })),
  ];
  const kpis = rigView ? rigKpis : mobileView ? mobileKpis : sdKpis;

  // Bars: one series, one colour. Every bar opens the matching list or hub.
  const statusRows = STATUS_ORDER.filter((st) => s[st] > 0)
    .sort((a, b) => s[b] - s[a])
    .map((st) => ({
      key: st,
      label: STATUS_LABELS[st],
      value: s[st],
      href: inventory({ status: st, ...(mobileView && { type: "mobile" }) }),
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
  // Hours since each item's last movement (send, receive, correction), as in the LATE_AFTER_HOURS rule.
  const lastMove = new Map<string, number>();
  for (const e of events) {
    const t = Date.parse(e.occurred_at);
    if (!Number.isNaN(t) && t > (lastMove.get(e.item_id) ?? -Infinity)) lastMove.set(e.item_id, t);
  }
  const hoursOut = (i: (typeof items)[number]) => {
    const t = lastMove.get(i.item_id) ?? Date.parse(i.updated_at);
    return Number.isNaN(t) ? 0 : Math.max(0, (now.getTime() - t) / 3_600_000);
  };
  const isLate = (i: (typeof items)[number]) => hoursOut(i) > LATE_AFTER_HOURS;
  // Only the LATE items of a person or hub (out for more than LATE_AFTER_HOURS): their senders and cities.
  const lateWith = (id: string, status: Status) => items.filter((i) => i.current_holder === id && i.status === status && isLate(i));
  const sentToPerson = (id: string, status: Status) => senders(lateWith(id, status));
  const sentToHub = (hubId: string) => senders(items.filter((i) => i.status === "pending" && i.current_hub === hubId && isLate(i)));
  const cityOfPerson = (id: string, status: Status) => {
    const late = [...new Set(lateWith(id, status).map((i) => hubCity.get(i.current_hub) ?? i.current_hub))].filter(Boolean);
    if (late.length) return late.sort().join(", ");
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
        late: items.filter((i) => i.status === "pending" && i.current_hub === g.key && isLate(i)),
      });
    } else {
      attention.push({
        key: `late-${g.kind}-${g.key}`,
        person: g.label,
        role: g.kind === "fo" ? "FO" : "IFO",
        city: cityOfPerson(g.key, g.kind === "fo" ? "with_fo" : "traveling"),
        sentBy: sentToPerson(g.key, g.kind === "fo" ? "with_fo" : "traveling"),
        items: g.count,
        hours: g.oldestHours,
        outFor: howLong(g.oldestHours),
        issue: g.kind === "fo" ? "Not returned" : "Not arrived",
        href: inventory({ holder: g.key, status: g.kind === "fo" ? "with_fo" : "traveling" }),
        tone: "warning",
        late: lateWith(g.key, g.kind === "fo" ? "with_fo" : "traveling"),
      });
    }
  }

  // Rig team and internal team: items still with them for more than LATE_AFTER_HOURS since their last
  // movement (same rule as FO / IFO). IMs are not listed here: items sent to an IM and not received yet are
  // already the hub's "Sent, not received" row, and items in stock with an IM are not out.
  const heldBy = new Map<string, { status: Status; count: number; hours: number }>();
  for (const i of items) {
    if (i.status !== "with_rig" && i.status !== "with_internal") continue;
    if (!i.current_holder || seen.has(i.current_holder)) continue;
    const hours = hoursOut(i);
    if (hours <= LATE_AFTER_HOURS) continue;
    const g = heldBy.get(i.current_holder) ?? { status: i.status, count: 0, hours: 0 };
    g.count++;
    g.hours = Math.max(g.hours, hours);
    heldBy.set(i.current_holder, g);
  }
  for (const [personId, g] of heldBy) {
    const person = people.find((p) => p.person_id === personId);
    attention.push({
      key: `late-held-${personId}`,
      person: person?.name ?? personId,
      role: person ? ROLE_LABELS[person.role] : g.status === "with_rig" ? "Rig team" : "Internal",
      city: cityOfPerson(personId, g.status),
      sentBy: sentToPerson(personId, g.status),
      items: g.count,
      hours: g.hours,
      outFor: howLong(g.hours),
      issue: "Not returned",
      href: inventory({ holder: personId, status: g.status }),
      tone: "warning",
      late: lateWith(personId, g.status),
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
  // Delayed item history: ?adetail=<row key> opens the list of that row's delayed items under the table.
  const detailKey = one(sp.adetail);
  const detailRow = attention.find((a) => a.key === detailKey && a.late?.length);
  const attentionKeep = () => {
    const q: Record<string, string> = {};
    for (const k of ["type", "empty", "acity", "arole", "mperson", "mcity", "mrole", "mfrom", "mto"]) if (one(sp[k])) q[k] = one(sp[k]);
    return q;
  };
  const detailHref = (key: string) => `/dashboard?${new URLSearchParams({ ...attentionKeep(), adetail: key })}#delayed-items`;
  const closeDetailHref = `/dashboard?${new URLSearchParams(attentionKeep())}#attention`;
  const TYPE_NAME: Record<string, string> = { sd_card: "SD card", rig: "Rig", mobile: "Mobile" };
  const detailRows = (detailRow?.late ?? [])
    .map((i) => {
      const e = eventById.get(i.last_event_id);
      const sentAt = lastMove.get(i.item_id) ?? Date.parse(i.updated_at);
      return {
        id: i.item_id,
        type: TYPE_NAME[i.item_type] ?? i.item_type,
        city: hubCity.get(i.current_hub) ?? i.current_hub,
        sentBy: (e?.from_person || personName.get(e?.from_id ?? "") || e?.from_id || "—").trim() || "—",
        sentOn: Number.isNaN(sentAt) ? "—" : formatIst(new Date(sentAt).toISOString()),
        hours: hoursOut(i),
        status: STATUS_LABELS[i.status] ?? i.status,
      };
    })
    .sort((a, b) => b.hours - a.hours || a.id.localeCompare(b.id));
  // "Moved per day" chart: person, city and role filters (?mperson=…&mcity=…&mrole=…). Other settings are kept.
  const movePerson = one(sp.mperson);
  const moveCity = one(sp.mcity);
  const moveRole = one(sp.mrole);
  // Date range (?mfrom=YYYY-MM-DD&mto=YYYY-MM-DD). Default: the last 14 days.
  const moveRange = pickRange(one(sp.mfrom), one(sp.mto), now, 14);
  const movedDays = dailyMoves(events, hubs, moveRange, { person: movePerson, city: moveCity, role: moveRole }, people);
  const moveOptions = moveFilterOptions(events, hubs, people, moveRange);
  const moveKeep: Record<string, string> = {};
  for (const k of ["type", "acity", "arole", "empty"]) if (one(sp[k])) moveKeep[k] = one(sp[k]);

  const keepParams: Record<string, string> = {};
  if (one(sp.type)) keepParams.type = one(sp.type);
  if (showEmpty) keepParams.empty = "1";
  if (movePerson) keepParams.mperson = movePerson;
  if (moveCity) keepParams.mcity = moveCity;
  if (moveRole) keepParams.mrole = moveRole;
  if (one(sp.mfrom)) keepParams.mfrom = one(sp.mfrom);
  if (one(sp.mto)) keepParams.mto = one(sp.mto);

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
                {n(d.total)} {mobileView ? "mobiles" : "items"} · {activeHubs} hubs · the latest known position of every item
              </p>
            </div>
          </div>
          <div className={styles.actions}>
            {/* Primary / secondary role switch, in the top bar. */}
            <RoleSwitch role={user.role} primaryRole={user.primaryRole} secondaryRole={user.secondaryRole} back="/dashboard" />
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

        <TypeSwitch role={user.role} current={type} path="/dashboard" includeAll={false} />

        {/* Mobiles: no SD card storage / colour summary; the tiles below start with the total. */}
        {!mobileView && <SummaryKpis d={d} items={items} rigView={rigView} />}

        {/* Mobile tiles: an even 3-column grid (3 + 3 on a laptop, 2 per row on a tablet, 1 on a phone). */}
        {mobileView && (
          <style>{`
.kpi-mob.kpi-mob{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.kpi-mob.kpi-mob > * span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:820px){.kpi-mob.kpi-mob{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:480px){.kpi-mob.kpi-mob{grid-template-columns:1fr}}
`}</style>
        )}
        {/* SD card tiles: rows that always fill the full width (4 + 3 on a laptop), labels on one line. */}
        {!rigView && !mobileView && (
          <style>{`
.kpi-sd.kpi-sd{display:flex;flex-wrap:wrap;gap:12px}
.kpi-sd.kpi-sd > *{flex:1 1 230px;min-width:0}
.kpi-sd.kpi-sd > * span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`}</style>
        )}
        <section
          className={rigView ? `${styles.kpiGrid} ${styles.kpiGridRig}` : mobileView ? `${styles.kpiGrid} kpi-mob` : `${styles.kpiGrid} kpi-sd`}
          aria-label="Overview"
        >
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
          <RigMetrics
            items={items}
            events={events}
            people={people}
            hubs={hubs}
            qcChecks={qcChecks}
            hardwareUpdates={hardwareUpdates}
            now={now}
          />
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

        {mobileView && <MobileCharts items={items} />}

        <DailyMoves
          title={rigView ? "Rigs moved per day" : mobileView ? "Mobiles moved per day" : "SD cards moved per day"}
          unit={rigView ? "rigs" : mobileView ? "mobiles" : "SD cards"}
          days={movedDays}
          people={moveOptions.people}
          cities={moveOptions.cities}
          roles={moveOptions.roles}
          person={movePerson}
          city={moveCity}
          role={moveRole}
          from={moveRange.from}
          to={moveRange.to}
          today={istDate(now)}
          datesChosen={!!(one(sp.mfrom) || one(sp.mto))}
          cut={moveRange.cut}
          keep={moveKeep}
        />

        <div style={{ display: "grid", gap: 20 }}>
          {/* NEEDS ATTENTION — table (full width, so every column shows) */}
          <section className={styles.card} id="attention" aria-label="Needs attention" style={{ minWidth: 0 }}>
            <h2>Needs attention</h2>
            <p className={styles.muted}>
              FO, IFO, rig team, internal people or hubs holding items for more than {LATE_AFTER_HOURS} hours (a
              hub row = sent to that hub and not received yet), plus lost and damaged items. Items, City and Sent by
              count only those late items. Longest out first. Click a name or the Items number to see only the delayed items.
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
                            href={a.late?.length ? detailHref(a.key) : a.href}
                            title={a.late?.length ? "Show only the delayed items" : undefined}
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
                        <td className={styles.num}>
                          {a.late?.length ? (
                            <Link href={detailHref(a.key)} className={styles.link} title="Show only the delayed items">
                              {n(a.items)}
                            </Link>
                          ) : a.items ? (
                            n(a.items)
                          ) : (
                            "—"
                          )}
                        </td>
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

            {detailRow && (
              <div id="delayed-items" style={{ marginTop: 20, scrollMarginTop: 80 }}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <h3 style={{ margin: 0 }}>
                    Delayed items — {detailRow.person} ({detailRow.role}) · {n(detailRows.length)}
                  </h3>
                  <Link href={closeDetailHref} className={styles.link}>
                    Close
                  </Link>
                </div>
                <p className={styles.muted} style={{ margin: "4px 0 10px" }}>
                  Only items out for more than {LATE_AFTER_HOURS} hours since their last send or receive. Oldest first.
                </p>
                <div
                  className={styles.tableScroll}
                  role="region"
                  aria-label="Delayed items — scrollable table"
                  tabIndex={0}
                  style={{ maxHeight: "480px", maxWidth: "100%", overflowY: "auto", overflowX: "auto" }}
                >
                  <table className={styles.table} style={{ width: "100%", minWidth: "760px", borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        {["Item ID", "Type", "City", "Sent by", "Sent on", "Out for", "Status"].map((h) => (
                          <th key={h} scope="col" style={TH_STYLE}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detailRows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Link href={`/inventory?${new URLSearchParams({ q: r.id })}`} className={styles.link}>
                              {r.id}
                            </Link>
                          </td>
                          <td>{r.type}</td>
                          <td>{r.city}</td>
                          <td style={{ whiteSpace: "normal" }}>{r.sentBy}</td>
                          <td>{r.sentOn}</td>
                          <td>{howLong(r.hours)}</td>
                          <td>{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
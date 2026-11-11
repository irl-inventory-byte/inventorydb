import Link from "next/link";
import { LATE_AFTER_HOURS, type Dashboard } from "@/lib/dashboard";
import type { Item } from "@/lib/schema";
import { n } from "./charts";
import styles from "./dashboard.module.css";
import { Icon, type IconName } from "./icons";

const howLong = (hours: number) =>
  hours < 48 ? `${Math.floor(hours)} hours` : `${Math.floor(hours / 24)} days`;

const dayText = (days: number | null) =>
  days === null ? "" : days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;

/** Safely parse the attributes JSON. Missing or invalid JSON is treated as missing details. */
function readAttributes(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Keep the dashboard working when a record has invalid JSON.
  }
  return {};
}

function attributeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

interface Tile {
  label: string;
  count: number;
  pct: string;
  bg: string;
  border: string;
  text: string;
}

// Cycled across however many distinct capacities / colours actually show up, so the breakdown is never
// hard-coded to a fixed set of values the way SD card's 512/256 GB and Black/Green are.
const CAPACITY_PALETTE = [
  { bg: "#e0e7ff", border: "#6366f1", text: "#312e81" },
  { bg: "#dbeafe", border: "#2563eb", text: "#1e3a8a" },
  { bg: "#cffafe", border: "#0891b2", text: "#164e63" },
  { bg: "#ede9fe", border: "#7c3aed", text: "#4c1d95" },
];
const COLOUR_PALETTE = [
  { bg: "#dcfce7", border: "#16a34a", text: "#14532d" },
  { bg: "#fef3c7", border: "#d97706", text: "#78350f" },
  { bg: "#fce7f3", border: "#db2777", text: "#831843" },
  { bg: "#e0f2fe", border: "#0284c7", text: "#0c4a6e" },
];

/** Count power banks by a chosen attribute (capacity or colour), biggest group first, "Unknown" last. */
function breakdownBy(items: readonly Item[], attr: "capacity" | "color"): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.item_type !== "power_bank") continue;
    const raw = attributeText(readAttributes(item.attributes)[attr]);
    const label = raw || "Unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const known = [...counts.entries()].filter(([label]) => label !== "Unknown").sort((a, b) => b[1] - a[1]);
  const unknown = counts.get("Unknown") ?? 0;
  return [...known.map(([label, count]) => ({ label, count })), ...(unknown > 0 ? [{ label: "Unknown", count: unknown }] : [])];
}

interface SummaryCard {
  key: string;
  icon: IconName;
  label: string;
  value: string;
  note: string;
  href: string;
  meter?: number;
  warn?: boolean;
}

interface PowerBankSummaryProps {
  d: Dashboard;
  hubParam?: string;
  items: readonly Item[];
  attentionHref?: string;
  brokenCount?: number;
  retiredCount?: number;
}

/**
 * Power banks' own "Fleet" breakdown card — by Capacity (e.g. 10000 / 20000 mAh, whatever the sheet
 * actually has) and by Colour, instead of SD card's GB storage and Black/Green split. No New/Old (that's
 * the SD card sheet's own column) and no Rigs tile. Plain function, not a server component — everything
 * it needs is already in `items`/`d`, no extra sheet read.
 */
export function PowerBankSummary({ d, hubParam, items, attentionHref, brokenCount = 0, retiredCount = 0 }: PowerBankSummaryProps) {
  const list = (params: Record<string, string> = {}) =>
    `/inventory?${new URLSearchParams({
      ...(hubParam ? { hub: hubParam } : {}),
      type: "power_bank",
      ...params,
    })}`;

  const hubIds = new Set((hubParam ?? "").split(",").map((id) => id.trim()).filter(Boolean));
  const fleetItems = hubIds.size > 0 ? items.filter((i) => hubIds.has(i.current_hub)) : items;
  const powerBanks = fleetItems.filter((i) => i.item_type === "power_bank");

  const total = d.total;
  const unusable = total - d.usable;
  const pct = d.utilization === null ? null : Math.round(d.utilization);

  // Nothing tracked yet for this scope: the four cards below would otherwise show a confusing wall of
  // "0" and a bare "—" dash (Utilization has no ratio to compute with zero usable items). Show one clear
  // empty state instead, with a way to add the first power bank.
  if (total === 0) {
    return (
      <section className={styles.summaryGrid} aria-label="Management summary">
        <div
          className={styles.summary}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 10,
            gridColumn: "1 / -1",
            padding: "36px 24px",
          }}
        >
          <span className={styles.summaryIcon} style={{ color: "var(--text-muted)" }}>
            <Icon name="layers" size={28} />
          </span>
          <strong style={{ fontSize: "1.1rem", fontWeight: 600 }}>No power banks here yet</strong>
          <span className={styles.summaryNote} style={{ maxWidth: 420 }}>
            {hubParam
              ? "This hub doesn't have any power banks tracked yet. Add one to start seeing utilization and activity here."
              : "No power banks are tracked yet. Add one to start seeing utilization and activity here."}
          </span>
          <Link
            href={list()}
            style={{
              marginTop: 4,
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "var(--series-1)",
              textDecoration: "none",
            }}
          >
            View power bank inventory →
          </Link>
        </div>
      </section>
    );
  }

  const share = (count: number) => (powerBanks.length > 0 ? `${Math.round((count / powerBanks.length) * 100)}%` : "");
  const unusableTotal = brokenCount + retiredCount;
  const unusableShare = (count: number) => (unusableTotal > 0 ? `${Math.round((count / unusableTotal) * 100)}%` : "");

  const byCapacity = breakdownBy(powerBanks, "capacity").map((row, i) => ({
    label: row.label === "Unknown" ? "Unknown capacity" : row.label,
    count: row.count,
    pct: share(row.count),
    ...CAPACITY_PALETTE[i % CAPACITY_PALETTE.length],
  }));
  const byColour = breakdownBy(powerBanks, "color").map((row, i) => ({
    label: row.label === "Unknown" ? "Unknown colour" : row.label,
    count: row.count,
    pct: share(row.count),
    ...COLOUR_PALETTE[i % COLOUR_PALETTE.length],
  }));

  const fleetDetails: Tile[] = [
    ...byCapacity,
    ...byColour,
    ...(brokenCount > 0
      ? [{ label: "Broken power banks", count: brokenCount, pct: unusableShare(brokenCount), bg: "#fee2e2", border: "#dc2626", text: "#7f1d1d" }]
      : []),
    ...(retiredCount > 0
      ? [
          {
            label: "Retired power banks",
            count: retiredCount,
            pct: unusableShare(retiredCount),
            bg: "rgba(100, 116, 139, 0.18)",
            border: "#64748b",
            text: "var(--text-primary)",
          },
        ]
      : []),
  ];

  const cards: SummaryCard[] = [
    {
      key: "fleet",
      icon: "layers",
      label: "Fleet — power bank update",
      value: n(total),
      note: unusable > 0 ? `${n(unusable)} lost, damaged or retired · ${n(d.usable)} usable` : `${n(d.usable)} usable`,
      href: list(),
    },
    {
      key: "utilization",
      icon: "activity",
      label: "Utilization",
      value: pct === null ? "—" : `${pct}%`,
      note: `${n(d.outCount)} out of ${n(d.usable)} usable items`,
      href: list({ status: "pending,traveling,with_fo,with_rig,with_internal" }),
      meter: pct ?? 0,
    },
    {
      key: "waiting",
      icon: "inbox",
      label: "Waiting to be received",
      value: n(d.waiting),
      note: d.waiting > 0 ? `Sent or traveling · oldest ${dayText(d.oldestWaitingDays)}` : "Nothing waiting",
      href: hubParam ? list({ status: "pending,traveling" }) : "/handover/receive",
    },
    {
      key: "late",
      icon: "alert",
      label: "Late items",
      value: n(d.lateCards),
      note: d.lateCards > 0 ? `Over ${LATE_AFTER_HOURS} hours · oldest ${howLong(d.oldestLateHours ?? 0)}` : `Nothing over ${LATE_AFTER_HOURS} hours`,
      href: attentionHref ?? list({ status: "with_fo,traveling,pending", late: "1" }),
      warn: d.lateCards > 0,
    },
  ];
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c])) as Record<string, SummaryCard>;

  const cardInner = (card: SummaryCard) => (
    <>
      <span className={styles.summaryTop}>
        <span className={styles.summaryLabel}>{card.label}</span>
        <span className={`${styles.summaryIcon} ${card.warn ? styles.summaryIconWarn : ""}`}>
          <Icon name={card.icon} size={18} />
        </span>
      </span>
      <span className={styles.summaryValue}>{card.value}</span>
      {card.meter !== undefined && (
        <span className={styles.meter} role="img" aria-label={`${card.meter}% utilization`}>
          <i style={{ width: `${Math.max(0, Math.min(100, card.meter))}%` }} />
        </span>
      )}
      <span className={styles.summaryNote}>{card.note}</span>
    </>
  );

  const cardTop = (card: SummaryCard) => (
    <Link href={card.href} style={{ display: "contents" }}>
      {cardInner(card)}
    </Link>
  );

  return (
    <section
      className={styles.summaryGrid}
      aria-label="Management summary"
      style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 14, height: "auto", maxHeight: "none", overflow: "visible" }}
    >
      <div
        className={styles.summary}
        style={{ display: "flex", flexDirection: "column", flex: "1 1 320px", alignSelf: "flex-start", height: "auto", maxHeight: "none", minWidth: 0, overflow: "visible" }}
      >
        {cardTop(byKey.fleet)}

        {fleetDetails.length > 0 && (
          <span style={{ display: "block", flexShrink: 0, width: "100%", marginTop: 12, paddingTop: 12, borderTop: "1px solid #cbd5e1", whiteSpace: "normal" }}>
            <span style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
              {fleetDetails.map((detail) => (
                <span
                  key={detail.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    padding: "8px 10px",
                    minWidth: 0,
                    border: `1px solid ${detail.border}`,
                    borderLeft: `5px solid ${detail.border}`,
                    borderRadius: 8,
                    backgroundColor: detail.bg,
                    color: detail.text,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "normal" }}>{detail.label}</span>
                  <strong style={{ fontSize: 20, lineHeight: 1.3, display: "flex", alignItems: "baseline", gap: 6 }}>
                    {n(detail.count)}
                    {detail.pct && <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.75 }}>{detail.pct}</span>}
                  </strong>
                </span>
              ))}
            </span>
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", flex: "1 1 320px", alignSelf: "flex-start", gap: 14, minWidth: 0 }}>
        <div className={styles.summary} style={{ display: "flex", flexDirection: "column", height: "auto", maxHeight: "none", minWidth: 0, overflow: "visible" }}>
          {cardTop(byKey.utilization)}
          <span style={{ display: "block", width: "100%", marginTop: 12, paddingTop: 12, borderTop: "1px solid #cbd5e1", fontSize: 12, lineHeight: 1.5, color: "#334155", whiteSpace: "normal" }}>
            <strong>Utilization</strong> = items in use ÷ usable items.
            <br />
            <strong>In use</strong> = out of the hub: with an FO, IFO, rig team or internal person, or sent and not received yet.
            <br />
            <strong>Usable</strong> = every item except lost, damaged and retired.
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          <Link href={byKey.waiting.href} className={styles.summary}>
            {cardInner(byKey.waiting)}
          </Link>
          <Link href={byKey.late.href} className={styles.summary}>
            {cardInner(byKey.late)}
          </Link>
        </div>
      </div>
    </section>
  );
}
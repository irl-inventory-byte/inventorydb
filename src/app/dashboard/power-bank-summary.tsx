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

interface Tile {
  label: string;
  count: number;
  pct: string;
  bg: string;
  border: string;
  text: string;
}

// The capacity ("20000mAh") / colour ("Black") breakdown chips that used to render under the Fleet
// tile were removed per request. This used to compute them (CAPACITY_PALETTE, COLOUR_PALETTE, and a
// breakdownBy() helper reading each item's attributes.capacity / attributes.color) — if that breakdown
// comes back, it previously lived right here, cycling a palette per distinct value so it was never
// hard-coded to a fixed set the way SD card's 512/256 GB and Black/Green are.

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
  // "0" and a bare "—" dash (Utilization has no ratio to compute with zero usable items). Per request,
  // this section is simply left out of the dashboard until the first power bank is added — once one
  // exists in the database (status in_stock by default), `total` stops being 0 and the normal cards
  // below render as usual.
  if (total === 0) {
    return null;
  }

  const share = (count: number) => (powerBanks.length > 0 ? `${Math.round((count / powerBanks.length) * 100)}%` : "");
  const unusableTotal = brokenCount + retiredCount;
  const unusableShare = (count: number) => (unusableTotal > 0 ? `${Math.round((count / unusableTotal) * 100)}%` : "");

  // Capacity (e.g. "20000mAh") and colour ("Black") breakdown chips used to render here, under the
  // Fleet tile — removed per request (see the comment above these functions' old spot, further up).
  const fleetDetails: Tile[] = [
    ...(brokenCount > 0
      ? [{ label: "Broken power banks", count: brokenCount, pct: unusableShare(brokenCount), bg: "#fee2e2", border: "#dc2626", text: "#7f1d1d" }]
      : []),
    ...(retiredCount > 0
      ? [
          {
            // Matches Broken's red palette instead of a mismatched grey — Broken and Retired are one
            // pair (both "unusable"), same change made on the SD card dashboard tab.
            label: "Retired power banks",
            count: retiredCount,
            pct: unusableShare(retiredCount),
            bg: "#fee2e2",
            border: "#dc2626",
            text: "#7f1d1d",
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
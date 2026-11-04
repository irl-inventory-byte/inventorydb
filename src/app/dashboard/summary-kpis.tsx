import { Fragment } from "react";
import Link from "next/link";
import { LATE_AFTER_HOURS, type Dashboard } from "@/lib/dashboard";
import type { Item } from "@/lib/schema";
import { getStore } from "@/lib/store";
import { loadAssetRecords } from "@/lib/asset-sheet";
import { n } from "./charts";
import styles from "./dashboard.module.css";
import { Icon, type IconName } from "./icons";

const howLong = (hours: number) =>
  hours < 48 ? `${Math.floor(hours)} hours` : `${Math.floor(hours / 24)} days`;

const dayText = (days: number | null) =>
  days === null ? "" : days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;

interface FleetCounts {
  storage512: number;
  storage256: number;
  storageUnknown: number;
  black: number;
  green: number;
  sdCards: number;
  rigs: number;
  newCards: number;
  oldCards: number;
  ageUnknown: number;
}

const SHEET_TIMEOUT_MS = 4000;

async function sheetAges(): Promise<Map<string, string> | null> {
  try {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), SHEET_TIMEOUT_MS));
    const records = await Promise.race([loadAssetRecords(), timeout]);
    if (!records) return null;
    return new Map(records.map((r) => [r.itemId.trim().toUpperCase(), (r.condition ?? "").trim().toLowerCase()]));
  } catch {
    return null;
  }
}

interface SummaryKpisProps {
  d: Dashboard;
  hubParam?: string;
  items?: readonly Item[];
  rigView?: boolean;
  attentionHref?: string;
  baselineTotal?: number;
  baselineStorage?: { gb256: number; gb512: number };
  brokenCount?: number;
  retiredCount?: number;
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

interface FleetTile {
  label: string;
  count: number;
  pct: string;
  bg: string;
  border: string;
  text: string;
  heading?: string;
}

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

function countFleet(items: readonly Item[], ages: Map<string, string> | null): FleetCounts {
  const counts: FleetCounts = {
    storage512: 0,
    storage256: 0,
    storageUnknown: 0,
    black: 0,
    green: 0,
    sdCards: 0,
    rigs: 0,
    newCards: 0,
    oldCards: 0,
    ageUnknown: 0,
  };

  for (const item of items) {
    if (item.item_type === "rig") {
      counts.rigs++;
      continue;
    }
    counts.sdCards++;

    const age = ages?.get(item.item_id.trim().toUpperCase()) ?? "";
    if (age.startsWith("new")) counts.newCards++;
    else if (age.startsWith("old")) counts.oldCards++;
    else counts.ageUnknown++;

    const attributes = readAttributes(item.attributes);
    const capacity = attributeText(attributes.capacity).replace(/\s+/g, "").toUpperCase();

    if (capacity === "512GB" || capacity === "512") counts.storage512++;
    else if (capacity === "256GB" || capacity === "256") counts.storage256++;
    else counts.storageUnknown++;

    const colour = attributeText(attributes.card_type).toLowerCase();
    if (colour === "black") counts.black++;
    else if (colour === "green") counts.green++;
  }

  return counts;
}

/**
 * Server component.
 * Do not add "use client" to this file: getStore() must run on the server.
 */
export async function SummaryKpis({
  d,
  hubParam,
  items,
  rigView = false,
  attentionHref,
  baselineTotal = 0,
  baselineStorage,
  brokenCount = 0,
  retiredCount = 0,
}: SummaryKpisProps) {
  const list = (params: Record<string, string> = {}) =>
    `/inventory?${new URLSearchParams({
      ...(hubParam ? { hub: hubParam } : {}),
      ...(rigView ? { type: "rig" } : {}),
      ...params,
    })}`;

  const sourceItems = items !== undefined ? items : await getStore().list("items");

  const hubIds = new Set(
    (hubParam ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );

  const fleetItems =
    hubIds.size > 0 ? sourceItems.filter((item) => hubIds.has(item.current_hub)) : sourceItems;

  const hasSd = fleetItems.some((i) => i.item_type !== "rig" && i.item_type !== "mobile");
  const ages = hasSd ? await sheetAges() : null;
  const fleet = countFleet(fleetItems, ages);
  if (baselineStorage) {
    fleet.storage512 += baselineStorage.gb512;
    fleet.storage256 += baselineStorage.gb256;
    fleet.sdCards += baselineTotal;
  }

  // Manual adjustment (SD cards only, not rigs): Green cards +89, Old cards +93.
  const EXTRA_GREEN = 89;
  const EXTRA_OLD = 93;
  if (!rigView) {
    fleet.green += EXTRA_GREEN;
    if (ages) fleet.oldCards += EXTRA_OLD;
  }

  const scopeMismatch = fleetItems.length !== d.total;

  const total = d.total + baselineTotal;
  const unusable = total - d.usable;
  const pct = d.utilization === null ? null : Math.round(d.utilization);

  // Rig view keeps the original four-card grid; SD cards get the new layout.
  const sdLayout = !rigView;

  const share = (count: number) => (fleet.sdCards > 0 ? `${Math.round((count / fleet.sdCards) * 100)}%` : "");

  const sdDetails: FleetTile[] = [
    {
      label: "512 GB",
      heading: "Usable",
      count: fleet.storage512,
      pct: share(fleet.storage512),
      bg: "#e0e7ff",
      border: "#6366f1",
      text: "#312e81",
    },
    {
      label: "256 GB",
      count: fleet.storage256,
      pct: share(fleet.storage256),
      bg: "#e0e7ff",
      border: "#6366f1",
      text: "#312e81",
    },
    {
      label: "Black cards",
      count: fleet.black,
      pct: share(fleet.black),
      bg: "#dcfce7",
      border: "#16a34a",
      text: "#14532d",
    },
    {
      label: "Green cards",
      count: fleet.green,
      pct: share(fleet.green),
      bg: "#dcfce7",
      border: "#16a34a",
      text: "#14532d",
    },
    ...(ages
      ? [
          {
            label: "New cards",
            count: fleet.newCards,
            pct: share(fleet.newCards),
            bg: "#e0f2fe",
            border: "#0284c7",
            text: "#0c4a6e",
          },
          {
            label: "Old cards",
            count: fleet.oldCards,
            pct: share(fleet.oldCards),
            bg: "#f3f4f6",
            border: "#6b7280",
            text: "#1f2937",
          },
        ]
      : []),
  ];

  // Broken and Retired percentages are of the TOTAL fleet only.
  const totalShare = (count: number) => (total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "");

  const fleetDetails: FleetTile[] = [
    ...(fleet.sdCards > 0 ? sdDetails : []),
    ...(brokenCount > 0
      ? [
          {
            label: "Broken cards",
            heading: "Unusable",
            count: brokenCount,
            pct: totalShare(brokenCount),
            bg: "#fee2e2",
            border: "#dc2626",
            text: "#7f1d1d",
          },
        ]
      : []),
    ...(retiredCount > 0
      ? [
          {
            label: "Retired cards",
            heading: brokenCount > 0 ? undefined : "Unusable",
            count: retiredCount,
            pct: totalShare(retiredCount),
            bg: "#f3f4f6",
            border: "#6b7280",
            text: "#1f2937",
          },
        ]
      : []),
    ...(fleet.rigs > 0
      ? [
          {
            label: "Rigs",
            count: fleet.rigs,
            pct: "",
            bg: "#fef3c7",
            border: "#d97706",
            text: "#78350f",
          },
        ]
      : []),
  ];

  const fleetCard: SummaryCard = {
    key: "fleet",
    icon: "layers",
    label: rigView ? "Rigs" : fleet.sdCards > 0 ? "Fleet — storage update" : "Fleet",
    value: n(total),
    note:
      unusable > 0
        ? `${n(unusable)} lost, damaged or retired · ${n(d.usable)} usable`
        : `${n(d.usable)} usable`,
    href: list(),
  };

  const utilCard: SummaryCard = {
    key: "utilization",
    icon: "activity",
    label: "Utilization",
    value: pct === null ? "—" : `${pct}%`,
    note: `${n(d.outCount)} out of ${n(d.usable)} usable items`,
    href: list({
      status: rigView
        ? "pending,traveling,with_fo,with_qc,with_hardware,with_internal"
        : "pending,traveling,with_fo,with_rig,with_internal",
    }),
    meter: pct ?? 0,
  };

  const waitingCard: SummaryCard = {
    key: "waiting",
    icon: "inbox",
    label: "Waiting to be received",
    value: n(d.waiting),
    note:
      d.waiting > 0
        ? `Sent or traveling · oldest ${dayText(d.oldestWaitingDays)}`
        : "Nothing waiting",
    href: hubParam ? list({ status: "pending,traveling" }) : "/handover/receive",
  };

  const lateCard: SummaryCard = {
    key: "late",
    icon: "alert",
    label: "Late items",
    value: n(d.lateCards),
    note:
      d.lateCards > 0
        ? `Over ${LATE_AFTER_HOURS} hours · oldest ${howLong(d.oldestLateHours ?? 0)}`
        : `Nothing over ${LATE_AFTER_HOURS} hours`,
    href: attentionHref ?? list({ status: "with_fo,traveling,pending", late: "1" }),
    warn: d.lateCards > 0,
  };

  const header = (card: SummaryCard) => (
    <span className={styles.summaryTop}>
      <span className={styles.summaryLabel}>{card.label}</span>
      <span className={`${styles.summaryIcon} ${card.warn ? styles.summaryIconWarn : ""}`}>
        <Icon name={card.icon} size={18} />
      </span>
    </span>
  );

  // RIGS: original four-card grid.
  if (!sdLayout) {
    return (
      <section
        className={styles.summaryGrid}
        aria-label="Management summary"
        style={{ height: "auto", maxHeight: "none", overflow: "visible" }}
      >
        {[fleetCard, utilCard, waitingCard, lateCard].map((card) => (
          <Link key={card.key} href={card.href} className={styles.summary}>
            {header(card)}
            <span className={styles.summaryValue}>{card.value}</span>
            {card.meter !== undefined && (
              <span className={styles.meter} role="img" aria-label={`${card.meter}% utilization`}>
                <i style={{ width: `${Math.max(0, Math.min(100, card.meter))}%` }} />
              </span>
            )}
            <span className={styles.summaryNote}>{card.note}</span>
            {card.key === "utilization" && (
              <span
                style={{
                  display: "block",
                  marginTop: 12,
                  paddingTop: 12,
                  borderTop: "1px solid #cbd5e1",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "#334155",
                }}
              >
                <strong>Utilization</strong> = items in use ÷ usable items.
                <br />
                <strong>In use</strong> = out of the hub: with an FO, IFO, rig team or internal person, or sent
                and not received yet.
                <br />
                <strong>Usable</strong> = every item except lost, damaged and retired.
              </span>
            )}
          </Link>
        ))}
      </section>
    );
  }

  // SD CARDS: Fleet box, then Utilization box with Waiting + Late inside.
  return (
    <section
      className={`${styles.summaryGrid} ${styles.summaryRows}`}
      aria-label="Management summary"
      style={{ height: "auto", maxHeight: "none", overflow: "visible" }}
    >
      {/* BOX 1: Fleet */}
      <Link
        href={fleetCard.href}
        className={styles.summary}
        style={{
          display: "flex",
          flexDirection: "column",
          height: "auto",
          maxHeight: "none",
          minWidth: 0,
          overflow: "visible",
        }}
      >
        {header(fleetCard)}
        <span className={styles.summaryValue}>{fleetCard.value}</span>
        <span className={styles.summaryNote}>{fleetCard.note}</span>

        {fleetDetails.length > 0 && (
          <span
            style={{
              display: "block",
              flexShrink: 0,
              width: "100%",
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid #cbd5e1",
              whiteSpace: "normal",
            }}
          >
            <span
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 8,
              }}
            >
              {fleetDetails.map((detail) => (
                <Fragment key={detail.label}>
                  {detail.heading && (
                    <span
                      style={{
                        gridColumn: "1 / -1",
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "#475569",
                        marginTop: 4,
                      }}
                    >
                      {detail.heading}
                    </span>
                  )}
                  <span
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
                    <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "normal" }}>
                      {detail.label}
                    </span>
                    <strong
                      style={{
                        fontSize: 20,
                        lineHeight: 1.3,
                        display: "flex",
                        alignItems: "baseline",
                        gap: 6,
                      }}
                    >
                      {n(detail.count)}
                      {detail.pct && (
                        <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.75 }}>{detail.pct}</span>
                      )}
                    </strong>
                  </span>
                </Fragment>
              ))}
            </span>

            {fleet.storageUnknown > 0 && (
              <span style={{ display: "block", marginTop: 8, fontSize: 12 }}>
                Unknown / other storage: {n(fleet.storageUnknown)}
              </span>
            )}

            {hasSd && !ages && (
              <span style={{ display: "block", marginTop: 8, fontSize: 12 }}>
                New / Old: the SD card sheet could not be read right now.
              </span>
            )}

            {scopeMismatch && (
              <span style={{ display: "block", marginTop: 8, fontSize: 12, fontWeight: 600 }}>
                Breakdown covers {n(fleetItems.length)} items; Fleet shows {n(d.total)}. Refresh the page. If
                this persists, check the hub scope.
              </span>
            )}
          </span>
        )}
      </Link>

      {/* BOX 2: Utilization, with Waiting and Late inside it */}
      <div
        className={styles.summary}
        style={{ height: "auto", maxHeight: "none", minWidth: 0, overflow: "visible" }}
      >
        <Link href={utilCard.href} className={styles.utilBody}>
          <span className={styles.utilLeft}>
            {header(utilCard)}
            <span className={styles.summaryValue}>{utilCard.value}</span>
            <span className={styles.meter} role="img" aria-label={`${utilCard.meter}% utilization`}>
              <i style={{ width: `${Math.max(0, Math.min(100, utilCard.meter ?? 0))}%` }} />
            </span>
            <span className={styles.summaryNote}>{utilCard.note}</span>
          </span>
          <span className={styles.utilDefn}>
            <strong>Utilization</strong> = items in use ÷ usable items.
            <br />
            <strong>In use</strong> = out of the hub: with an FO, IFO, rig team or internal person, or sent and
            not received yet.
            <br />
            <strong>Usable</strong> = every item except lost, damaged and retired.
          </span>
        </Link>

        <div className={styles.utilTiles}>
          {[waitingCard, lateCard].map((card) => (
            <Link key={card.key} href={card.href} className={styles.utilTile}>
              {header(card)}
              <span className={styles.summaryValue}>{card.value}</span>
              <span className={styles.summaryNote}>{card.note}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
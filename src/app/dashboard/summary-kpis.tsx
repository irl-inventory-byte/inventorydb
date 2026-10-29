import Link from "next/link";
import { LATE_AFTER_HOURS, type Dashboard } from "@/lib/dashboard";
import type { Item } from "@/lib/schema";
import { getStore } from "@/lib/store";
import { loadAssetRecords } from "@/lib/asset-sheet";
import { n } from "./charts";
import styles from "./dashboard.module.css";
import { Icon, type IconName } from "./icons";

const howLong = (hours: number) =>
  hours < 48
    ? `${Math.floor(hours)} hours`
    : `${Math.floor(hours / 24)} days`;

const dayText = (days: number | null) =>
  days === null
    ? ""
    : days === 0
      ? "today"
      : `${days} day${days === 1 ? "" : "s"} ago`;

interface FleetCounts {
  storage512: number;
  storage256: number;
  storageUnknown: number;
  black: number;
  green: number;
  colourUnknown: number;
  sdCards: number;
  rigs: number;
  newCards: number; // "New" in the SD card sheet's New/Old column
  oldCards: number; // "Old"
  ageUnknown: number; // not in the sheet, or New/Old blank
}

/**
 * New / Old for every SD card in the inventory, from the SD card sheet's New/Old column (matched by Asset
 * Tag). The sheet is read through the same short cache as Add SD card. null = the sheet could not be read.
 */
async function sheetAges(): Promise<Map<string, string> | null> {
  try {
    const records = await loadAssetRecords();
    return new Map(records.map((r) => [r.itemId.trim().toUpperCase(), (r.condition ?? "").trim().toLowerCase()]));
  } catch {
    return null;
  }
}

interface SummaryKpisProps {
  d: Dashboard;

  // For a hub dashboard, include every hub ID in its scope.
  // Multiple IDs must be comma-separated.
  hubParam?: string;

  // Existing callers may pass items directly.
  // If omitted, this component loads the items itself.
  items?: readonly Item[];
  /** Rigs view: the first card is "Rigs" and its links show rigs only. */
  rigView?: boolean;
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

/**
 * Safely parse the attributes JSON.
 * Missing or invalid JSON is treated as missing card details.
 */
function readAttributes(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Keep the dashboard working when a record has invalid JSON.
  }

  return {};
}

/** Read a string or numeric attribute without coercing objects. */
function attributeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

/**
 * Read the fields saved by the updated Add item action:
 *
 * {
 *   "capacity": "512 GB",
 *   "card_type": "Black"
 * }
 *
 * Storage and colour are separate breakdowns of the same items.
 */
function countFleet(items: readonly Item[], ages: Map<string, string> | null): FleetCounts {
  const counts: FleetCounts = {
    storage512: 0,
    storage256: 0,
    storageUnknown: 0,
    black: 0,
    green: 0,
    colourUnknown: 0,
    sdCards: 0,
    rigs: 0,
    newCards: 0,
    oldCards: 0,
    ageUnknown: 0,
  };

  for (const item of items) {
    // Storage and colour only apply to SD cards; rigs are counted separately.
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

    const capacity = attributeText(attributes.capacity)
      .replace(/\s+/g, "")
      .toUpperCase();

    if (capacity === "512GB" || capacity === "512") {
      counts.storage512++;
    } else if (capacity === "256GB" || capacity === "256") {
      counts.storage256++;
    } else {
      counts.storageUnknown++;
    }

    const colour = attributeText(
      attributes.card_type
    ).toLowerCase();

    if (colour === "black") {
      counts.black++;
    } else if (colour === "green") {
      counts.green++;
    } else {
      counts.colourUnknown++;
    }
  }

  return counts;
}

/**
 * Server component.
 * Do not add "use client" to this file:
 * getStore() must run on the server.
 */
export async function SummaryKpis({
  d,
  hubParam,
  items,
  rigView = false,
}: SummaryKpisProps) {
  const list = (params: Record<string, string> = {}) =>
    `/inventory?${new URLSearchParams({
      ...(hubParam ? { hub: hubParam } : {}),
      ...(rigView ? { type: "rig" } : {}),
      ...params,
    })}`;

  // NEW: load inventory here when the parent did not pass items.
  // This allows the existing <SummaryKpis d={d} /> call to work.
  const sourceItems =
    items !== undefined
      ? items
      : await getStore().list("items");

  // Scope the breakdown to the hub IDs supplied by a hub page.
  const hubIds = new Set(
    (hubParam ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );

  const fleetItems =
    hubIds.size > 0
      ? sourceItems.filter((item) =>
          hubIds.has(item.current_hub)
        )
      : sourceItems;

  const hasSd = fleetItems.some((i) => i.item_type !== "rig" && i.item_type !== "mobile");
  const ages = hasSd ? await sheetAges() : null;
  const fleet = countFleet(fleetItems, ages);

  // A second read can differ if inventory changed during rendering,
  // or if the caller supplied a different hub scope.
  const scopeMismatch = fleetItems.length !== d.total;

  const unusable = d.total - d.usable;
  const pct =
    d.utilization === null
      ? null
      : Math.round(d.utilization);

  // Each tile has its own colour so the four are easy to tell apart:
  // storage in blues, card colour in the card's real colour.
  const sdDetails = [
    {
      label: "512 GB",
      count: fleet.storage512,
      bg: "#e0e7ff",
      border: "#6366f1",
      text: "#312e81",
    },
    {
      label: "256 GB",
      count: fleet.storage256,
      bg: "#e0e7ff",
      border: "#6366f1",
      text: "#312e81",
    },
    {
      label: "Black cards",
      count: fleet.black,
      bg: "#dcfce7",
      border: "#16a34a",
      text: "#14532d",
    },
    {
      label: "Green cards",
      count: fleet.green,
      bg: "#dcfce7",
      border: "#16a34a",
      text: "#14532d",
    },
    // New / Old from the SD card sheet (only when the sheet could be read).
    ...(ages
      ? [
          {
            label: "New cards",
            count: fleet.newCards,
            bg: "#e0f2fe",
            border: "#0284c7",
            text: "#0c4a6e",
          },
          {
            label: "Old cards",
            count: fleet.oldCards,
            bg: "#f3f4f6",
            border: "#6b7280",
            text: "#1f2937",
          },
        ]
      : []),
  ];

  // SD card tiles only when there are SD cards; a Rigs tile when there are rigs.
  const fleetDetails = [
    ...(fleet.sdCards > 0 ? sdDetails : []),
    ...(fleet.rigs > 0
      ? [
          {
            label: "Rigs",
            count: fleet.rigs,
            bg: "#fef3c7",
            border: "#d97706",
            text: "#78350f",
          },
        ]
      : []),
  ];

  const cards: SummaryCard[] = [
    {
      key: "fleet",
      icon: "layers",
      // Rig view says "Rigs"; SD cards keep "Fleet".
      label: rigView ? "Rigs" : fleet.sdCards > 0 ? "Fleet — storage update" : "Fleet",
      value: n(d.total),
      note:
        unusable > 0
          ? `${n(d.usable)} usable · ${n(
              unusable
            )} lost, damaged or retired`
          : `${n(d.usable)} usable`,
      href: list(),
    },
    {
      key: "utilization",
      icon: "activity",
      label: "Utilization",
      value: pct === null ? "—" : `${pct}%`,
      note: `${n(d.outCount)} out of ${n(
        d.usable
      )} usable items`,
      href: list({
        status: rigView
          ? "pending,traveling,with_fo,with_qc,with_hardware,with_internal"
          : "pending,traveling,with_fo,with_rig,with_internal",
      }),
      meter: pct ?? 0,
    },
    {
      key: "waiting",
      icon: "inbox",
      label: "Waiting to be received",
      value: n(d.waiting),
      note:
        d.waiting > 0
          ? `Sent or traveling · oldest ${dayText(
              d.oldestWaitingDays
            )}`
          : "Nothing waiting",
      href: hubParam
        ? list({ status: "pending,traveling" })
        : "/handover/receive",
    },
    {
      key: "late",
      icon: "alert",
      label: "Late items",
      value: n(d.lateCards),
      note:
        d.lateCards > 0
          ? `Over ${LATE_AFTER_HOURS} hours · oldest ${howLong(
              d.oldestLateHours ?? 0
            )}`
          : `Nothing over ${LATE_AFTER_HOURS} hours`,
      // Opens the inventory list with ONLY the late items
      // (and only this city's hubs when clicked from a city page).
      href: list({
        status: "with_fo,traveling,pending",
        late: "1",
      }),
      warn: d.lateCards > 0,
    },
  ];

  return (
    <section
      className={styles.summaryGrid}
      aria-label="Management summary"
      style={{
        height: "auto",
        maxHeight: "none",
        overflow: "visible",
      }}
    >
      {cards.map((card) => (
        <Link
          key={card.key}
          href={card.href}
          className={styles.summary}
          style={
            card.key === "fleet" || card.key === "utilization"
              ? {
                  display: "flex",
                  flexDirection: "column",
                  height: "auto",
                  maxHeight: "none",
                  minWidth: 0,
                  overflow: "visible",
                }
              : undefined
          }
        >
          {/* Existing card title and icon. */}
          <span className={styles.summaryTop}>
            <span className={styles.summaryLabel}>
              {card.label}
            </span>

            <span
              className={`${styles.summaryIcon} ${
                card.warn ? styles.summaryIconWarn : ""
              }`}
            >
              <Icon name={card.icon} size={18} />
            </span>
          </span>

          {/* Existing main metric. */}
          <span className={styles.summaryValue}>
            {card.value}
          </span>

          {/* Existing utilization meter. */}
          {card.meter !== undefined && (
            <span
              className={styles.meter}
              role="img"
              aria-label={`${card.meter}% utilization`}
            >
              <i
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, card.meter)
                  )}%`,
                }}
              />
            </span>
          )}

          <span className={styles.summaryNote}>
            {card.note}
          </span>

          {/* What Utilization means. */}
          {card.key === "utilization" && (
            <span
              style={{
                display: "block",
                width: "100%",
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid #cbd5e1",
                fontSize: 12,
                lineHeight: 1.5,
                color: "#334155",
                whiteSpace: "normal",
              }}
            >
              <strong>Utilization</strong> = items in use ÷ usable items.
              <br />
              <strong>In use</strong> = out of the hub: with an FO, IFO, rig team or internal person, or sent and not
              received yet.
              <br />
              <strong>Usable</strong> = every item except lost, damaged and retired.
            </span>
          )}

          {/* NEW: storage and colour details inside Fleet. */}
          {card.key === "fleet" && fleetDetails.length > 0 && (
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
                  gridTemplateColumns:
                    "repeat(2, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
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
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        whiteSpace: "normal",
                      }}
                    >
                      {detail.label}
                    </span>

                    <strong
                      style={{
                        fontSize: 20,
                        lineHeight: 1.3,
                      }}
                    >
                      {n(detail.count)}
                    </strong>
                  </span>
                ))}
              </span>

              {/* Never silently ignore missing attributes. */}
              {fleet.storageUnknown > 0 && (
                <span
                  style={{
                    display: "block",
                    marginTop: 8,
                    fontSize: 12,
                  }}
                >
                  Unknown / other storage:{" "}
                  {n(fleet.storageUnknown)}
                </span>
              )}

              {hasSd && !ages && (
                <span
                  style={{
                    display: "block",
                    marginTop: 8,
                    fontSize: 12,
                  }}
                >
                  New / Old: the SD card sheet could not be read right now.
                </span>
              )}

              {fleet.colourUnknown > 0 && (
                <span
                  style={{
                    display: "block",
                    marginTop: 8,
                    fontSize: 12,
                  }}
                >
                  Unknown / other colour:{" "}
                  {n(fleet.colourUnknown)}
                </span>
              )}

              {/* Flag differing scopes or concurrent data changes. */}
              {scopeMismatch && (
                <span
                  style={{
                    display: "block",
                    marginTop: 8,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Breakdown covers {n(fleetItems.length)} items;
                  Fleet shows {n(d.total)}. Refresh the page. If
                  this persists, check the hub scope.
                </span>
              )}

              <span
                style={{
                  display: "block",
                  marginTop: 8,
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: "#0284c7",
                  fontWeight: 600,
                }}
              >
              
              </span>
            </span>
          )}
        </Link>
      ))}
    </section>
  );
}
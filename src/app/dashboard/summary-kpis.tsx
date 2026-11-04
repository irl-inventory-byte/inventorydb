import Link from "next/link";
import { LATE_AFTER_HOURS, type Dashboard } from "@/lib/dashboard";
import type { Item } from "@/lib/schema";
import { getStore } from "@/lib/store";
import { loadAssetRecords } from "@/lib/asset-sheet";
import { setFleetAdjustments } from "./actions";
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
 *
 * This is a SEPARATE Google Sheet from the app's own database, read directly via the Sheets API —
 * on a cache miss (every 5 min) that can be several Google API round trips one after another. Rather
 * than let a slow or slow-to-authenticate read stall the whole dashboard, this gives it SHEET_TIMEOUT_MS
 * to finish; past that it falls back to null (same as "could not be read") and lets the page render.
 * The read keeps going in the background and fills the cache, so the next load is normally fast again.
 * (Bumped from 1.5s to 4s — 1.5s was timing out too often and New/Old kept falling back to the text
 * message instead of showing tiles. Combined with the 15-minute cache, most loads should still hit a
 * warm cache and render instantly; only a true cache-miss load pays this cost, and it's capped at 4s.)
 */
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

  // For a hub dashboard, include every hub ID in its scope.
  // Multiple IDs must be comma-separated.
  hubParam?: string;

  // Existing callers may pass items directly.
  // If omitted, this component loads the items itself.
  items?: readonly Item[];
  /** Rigs view: the first card is "Rigs" and its links show rigs only. */
  rigView?: boolean;
  /**
   * Where the "Late items" tile links to. When given, used instead of the default inventory list link —
   * e.g. the dashboard's own "#attention" section, showing every delayed card with no filter applied.
   * Omit on a page with no Needs attention table (the hub dashboard), where the default inventory link stays.
   */
  attentionHref?: string;
  /**
   * Cards the admin has recorded as already broken before this system tracked them (see the Broken
   * tile's "Starting count" box) — not real item rows, so they aren't in `items`/`d.total`. Added on
   * top here so Fleet's Total and usable/non-usable split agree with the Broken tile's own number.
   */
  baselineTotal?: number;
  baselineStorage?: { gb256: number; gb512: number };
  /** Broken and retired counts (already including each one's admin "starting count" baseline — see
   * the dashboard's "Broken / Retired" tile), shown as their own tiles in the Fleet breakdown below. */
  brokenCount?: number;
  retiredCount?: number;
  /**
   * Manual addition to the Green cards / Old cards breakdown tiles (SD cards only — never rigs), set
   * via the "Manual adjustment" box under the Fleet card. Same idea as `baselineTotal`/`brokenCount`:
   * a correction added on top of the live computed count, for cards whose colour/age was never
   * recorded. Omit (or leave undefined) to show the computed count as-is.
   */
  greenBaseline?: number;
  oldBaseline?: number;
  /** Only an admin sees the "Manual adjustment" edit box for Green cards / Old cards. */
  canEditFleetAdjustments?: boolean;
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
  attentionHref,
  baselineTotal = 0,
  baselineStorage,
  brokenCount = 0,
  retiredCount = 0,
  greenBaseline = 0,
  oldBaseline = 0,
  canEditFleetAdjustments = false,
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
  // Fold the admin's "already broken before tracking" baseline into the storage breakdown too, so
  // the 512/256 GB tiles and the Total agree with each other and with the Broken tile's own number.
  if (baselineStorage) {
    fleet.storage512 += baselineStorage.gb512;
    fleet.storage256 += baselineStorage.gb256;
    fleet.sdCards += baselineTotal;
  }
  // Manual "Green cards" / "Old cards" adjustment (see the Fleet card's own edit box) — cards whose
  // colour/age was never recorded, added on top of the live computed count. SD cards only.
  if (greenBaseline) fleet.green += greenBaseline;
  if (oldBaseline) fleet.oldCards += oldBaseline;

  // A second read can differ if inventory changed during rendering,
  // or if the caller supplied a different hub scope. (Compared against the real tracked total —
  // the baseline is phantom, not a row in `items`, so it's left out of this check on purpose.)
  const scopeMismatch = fleetItems.length !== d.total;

  const total = d.total + baselineTotal;
  const unusable = total - d.usable;
  const pct =
    d.utilization === null
      ? null
      : Math.round(d.utilization);

  // Share of the SD card total, e.g. 903 of 1479 = 61%. Shown next to each tile's count so the two
  // sides of a split (512 vs 256, Black vs Green, New vs Old) are easy to compare at a glance.
  const share = (count: number) => (fleet.sdCards > 0 ? `${Math.round((count / fleet.sdCards) * 100)}%` : "");

  // Each tile has its own colour so the four are easy to tell apart:
  // storage in blues, card colour in the card's real colour.
  const sdDetails = [
    // Total SD cards (separate from the Fleet card's own Total, which can also include rigs/baselines).
    {
      label: "SD cards",
      count: fleet.sdCards,
      pct: "",
      bg: "#ede9fe",
      border: "#7c3aed",
      text: "#4c1d95",
    },
    {
      label: "512 GB",
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
    // New / Old from the SD card sheet (only when the sheet could be read).
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

  // Broken and Retired's own percentage is of the two combined (how the unusable pile splits between
  // them), not of the whole fleet — e.g. Broken 89 of 94 unusable = 95%, not 89 of 1,653 total = 5%.
  const unusableTotal = brokenCount + retiredCount;
  const unusableShare = (count: number) => (unusableTotal > 0 ? `${Math.round((count / unusableTotal) * 100)}%` : "");

  // Order: SD card total, storage (512/256), colour (Black/Green), age (New/Old) — all from sdDetails —
  // then Broken, then Retired, then Rigs last. (No separate "Unusable" tile — the top note line above
  // already says "N lost, damaged or retired", and Broken + Retired below add up to that same N.)
  const fleetDetails = [
    ...(fleet.sdCards > 0 ? sdDetails : []),
    ...(brokenCount > 0
      ? [
          {
            label: "Broken cards",
            count: brokenCount,
            pct: unusableShare(brokenCount),
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
            count: retiredCount,
            pct: unusableShare(retiredCount),
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

  const cards: SummaryCard[] = [
    {
      key: "fleet",
      icon: "layers",
      // Rig view says "Rigs"; SD cards keep "Fleet".
      label: rigView ? "Rigs" : fleet.sdCards > 0 ? "Fleet — storage update" : "Fleet",
      value: n(total),
      note:
        unusable > 0
          ? `${n(unusable)} lost, damaged or retired · ${n(d.usable)} usable`
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
      // Opens the dashboard's own Needs attention table (every delayed card, unfiltered) when given one;
      // else the inventory list with ONLY the late items (and only this city's hubs from a city page).
      href:
        attentionHref ??
        list({
          status: "with_fo,traveling,pending",
          late: "1",
        }),
      warn: d.lateCards > 0,
    },
  ];
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c])) as Record<string, SummaryCard>;

  // The title/icon/value/meter/note content shared by every card.
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

  // Fleet and Utilization sit inside a plain <div> (not a Link) because they have more content below
  // the fold (the breakdown grid and, on Fleet, edit forms) — so just their title/value/note area is
  // wrapped in its own Link, same click target as before, without nesting a link inside a link.
  const cardTop = (card: SummaryCard) => (
    <Link href={card.href} style={{ display: "contents" }}>
      {cardInner(card)}
    </Link>
  );

  const fleetBack = `/dashboard${rigView ? "?type=rig" : ""}`;

  return (
    <section
      className={styles.summaryGrid}
      aria-label="Management summary"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
        gap: 14,
        alignItems: "start",
        height: "auto",
        maxHeight: "none",
        overflow: "visible",
      }}
    >
      {/* Fleet — storage update, on its own (left on desktop). */}
      <div
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
        {cardTop(byKey.fleet)}

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

            {/* Never silently ignore missing attributes. */}
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

            {/* "Unknown / other colour" line removed per request. */}

            {/* Flag differing scopes or concurrent data changes. */}
            {scopeMismatch && (
              <span style={{ display: "block", marginTop: 8, fontSize: 12, fontWeight: 600 }}>
                Breakdown covers {n(fleetItems.length)} items; Fleet shows {n(d.total)}. Refresh the page. If this
                persists, check the hub scope.
              </span>
            )}
          </span>
        )}

        {/* Admin-only: manual addition to Green cards / Old cards (SD cards only), for cards whose
            colour/age was never recorded. Added on top of the live computed count — see setFleetAdjustments. */}
        {canEditFleetAdjustments && (
          <form
            action={setFleetAdjustments}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginTop: 12,
              padding: "8px 10px",
              maxWidth: 260,
              border: "1px solid #dbe2ea",
              borderRadius: 10,
              background: "linear-gradient(180deg,#f8fafc,#f1f5f9)",
            }}
          >
            <input type="hidden" name="back" value={fleetBack} />
            <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748b" }}>
              Manual adjustment{greenBaseline || oldBaseline ? " · active" : ""}
            </span>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>+ Green cards</span>
                <input
                  type="number"
                  name="green"
                  min={0}
                  placeholder="0"
                  defaultValue={greenBaseline || ""}
                  style={{ width: 80, fontSize: "0.82rem", padding: "5px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>+ Old cards</span>
                <input
                  type="number"
                  name="old"
                  min={0}
                  placeholder="0"
                  defaultValue={oldBaseline || ""}
                  style={{ width: 80, fontSize: "0.82rem", padding: "5px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff" }}
                />
              </label>
              <button
                type="submit"
                style={{
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  padding: "6px 16px",
                  borderRadius: 6,
                  border: "1px solid #1e293b",
                  background: "#1e293b",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Right column: Utilization on top, Waiting to be received + Late items below it. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div
          className={styles.summary}
          style={{ display: "flex", flexDirection: "column", height: "auto", maxHeight: "none", minWidth: 0, overflow: "visible" }}
        >
          {cardTop(byKey.utilization)}
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
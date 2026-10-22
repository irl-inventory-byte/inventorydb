import Link from "next/link";
import { formatAttributes } from "@/lib/attributes";
import { requireRole } from "@/lib/authz";
import { LATE_AFTER_HOURS } from "@/lib/dashboard";
import { QC_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import { STATUSES, type QcCheck } from "@/lib/schema";
import { ADD_ROLES, MOBILE_ADD_ROLES, canSeeType, storeFor, storeForAll, typeParam } from "@/lib/access";
import { formatIst, istDate } from "@/lib/time";
import styles from "../admin/admin.module.css";
import { TypeBadge, rowTint } from "../ItemTypeBadge";
import TypeSwitch from "../TypeSwitch";
import AddCardForm from "./AddCardForm";
import MultiSelect from "./MultiSelect";
import RigAddForm from "./RigAddForm";
import RigBulkAddForm from "./RigBulkAddForm";
import MobileAddForm from "./MobileAddForm";
import MobileBulkAddForm from "./MobileBulkAddForm";
import { mobileHomeHub, rigHomeHub } from "@/lib/rig-hub";
import BulkAddForm from "./BulkAddForm";
import { applyCorrection } from "./actions";
import CorrectionPanel from "./CorrectionPanel";

const PAGE_SIZE = 100;

/** Read saved storage and colour without failing on invalid JSON. */
function readCardDetails(raw: string) {
  let attributes: Record<string, unknown> = {};

  try {
    const parsed: unknown = JSON.parse(raw || "{}");

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      attributes = parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or invalid details display as "Not set".
  }

  const rawCapacity = attributes.capacity;

  const capacityText =
    typeof rawCapacity === "string" ||
    typeof rawCapacity === "number"
      ? String(rawCapacity).trim()
      : "";

  const normalizedCapacity = capacityText
    .replace(/\s+/g, "")
    .toUpperCase();

  let storage = capacityText || "Not set";

  if (
    normalizedCapacity === "512GB" ||
    normalizedCapacity === "512"
  ) {
    storage = "512 GB";
  } else if (
    normalizedCapacity === "256GB" ||
    normalizedCapacity === "256"
  ) {
    storage = "256 GB";
  }

  const cardTypeText =
    typeof attributes.card_type === "string"
      ? attributes.card_type.trim()
      : "";

  const normalizedCardType = cardTypeText.toLowerCase();
  let cardType = cardTypeText || "Not set";

  if (normalizedCardType === "black") {
    cardType = "Black";
  } else if (normalizedCardType === "green") {
    cardType = "Green";
  }

  return { storage, cardType };
}

/** A mobile's saved details (Asset Tag, Serial, Model No., Category, Storage). */
function mobileDetails(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? "")]));
    }
  } catch {
    // Missing or invalid details show as "—".
  }
  return {};
}

/** Display the stored amount, without treating missing values as zero. */
function displayAmount(raw: string): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/₹/g, "")
    .replace(/\bINR\b/gi, "")
    .replace(/[,\s]/g, "");

  if (!cleaned || !/^\d+(?:\.\d+)?$/.test(cleaned)) {
    return "Not set";
  }

  const amount = Number(cleaned);

  if (!Number.isFinite(amount)) {
    return "Not set";
  }

  return amount.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function InventoryPage({
  searchParams,
}: PageProps<"/inventory">) {
  const user = await requireRole();

  // Corrections and Delete links remain Admin-only.
  const isAdmin = user.role === "admin";

  // CHANGED: show Add item to Admin, IM and Rig.
  const sp = await searchParams;
  // "SD cards / Rigs" switch; each login only ever sees its allowed types.
  const type = typeParam(one(sp.type), user.role);

  // SD cards: Admin, IM and Rig team. Rigs: Admin and IM.
  const canAdd =
    ADD_ROLES.includes(user.role) &&
    canSeeType(user.role, "sd_card") &&
    type !== "rig" &&
    type !== "mobile";
  const canAddRig =
    (user.role === "admin" || user.role === "im") && type !== "sd_card" && type !== "mobile";
  // Mobiles: Admin and IM, on the Mobile tab and under All items.
  const mobileView = type === "mobile";
  const canAddMobile = (mobileView || type === "") && MOBILE_ADD_ROLES.includes(user.role) && canSeeType(user.role, "mobile");

  const q = one(sp.q).trim().toLowerCase();

  // Filters can hold several values: ?status=a&status=b or ?status=a,b
  const many = (v: string | string[] | undefined) =>
    [...new Set((Array.isArray(v) ? v : [v ?? ""]).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean))];

  const statuses = many(sp.status);
  const status = statuses.join(",");

  const hubIds = many(sp.hub);
  const hub = hubIds.join(",");

  // Cities are compared trimmed and lower case.
  const cities = many(sp.city).map((c) => c.toLowerCase());
  const city = cities.join(",");

  // Date range (YYYY-MM-DD, IST) on each item's last movement.
  const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDay(one(sp.from)) ? one(sp.from) : "";
  const to = isDay(one(sp.to)) ? one(sp.to) : "";

  const holder = one(sp.holder);
  const lateOnly = one(sp.late) === "1";
  const requestedPage = Number(one(sp.page));

  const validPage =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;

  // All items: SD cards, rigs and mobiles together. A switch choice: that type only.
  const store = type ? storeFor(user.role, type) : storeForAll(user.role);

  const [items, hubs, people, events, qcChecks] = await Promise.all([
    store.list("items"),
    store.list("hubs"),
    store.list("people"),
    store.list("events"),
    canSeeType(user.role, "rig") && !mobileView ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
  ]);

  // Latest QC result per rig (rows are oldest first, so the last one wins).
  const latestQc = new Map<string, string>();
  for (const c of qcChecks) latestQc.set(c.item_id, c.qc_status);
  const showQc = canSeeType(user.role, "rig") && type !== "sd_card" && !mobileView;
  const QC_COLOR: Record<string, string> = { pass: "#15803D", repaired: "#15803D", fail: "#B42318", qc_pending: "#8A4B00" };

  // Each item's latest movement, used for the From / To columns.
  const eventById = new Map(
    events.map((e) => [e.event_id, e])
  );

  const hubName = new Map(
    hubs.map((h) => [h.hub_id, h.name])
  );

  // A hub's city: its city, or its name when the city is blank.
  const cityLabelOf = (h: (typeof hubs)[number]) => (h.city ?? "").trim() || h.name.trim();
  const hubCity = new Map(hubs.map((h) => [h.hub_id, cityLabelOf(h).toLowerCase()]));
  const cityOptions = [
    ...new Map(hubs.map((h) => [cityLabelOf(h).toLowerCase(), cityLabelOf(h)])).entries(),
  ]
    .filter(([key]) => key)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));

  const personName = new Map(
    people.map((p) => [p.person_id, p.name])
  );

  // Late = with an FO, traveling, or sent and not received, for more than LATE_AFTER_HOURS
  // since its last movement. Same rule as the "Late items" tile on the dashboard.
  const lastAt = new Map<string, number>();
  for (const e of events) {
    const t = Date.parse(e.occurred_at);
    if (!Number.isNaN(t) && t > (lastAt.get(e.item_id) ?? -Infinity)) lastAt.set(e.item_id, t);
  }
  const nowMs = Date.now();
  const isLate = (item: (typeof items)[number]) => {
    if (item.status !== "with_fo" && item.status !== "traveling" && item.status !== "pending") return false;
    const t = lastAt.get(item.item_id) ?? Date.parse(item.updated_at);
    return !Number.isNaN(t) && (nowMs - t) / 3_600_000 > LATE_AFTER_HOURS;
  };

  // The IST day an item last moved (send, receive, correction or add).
  const lastDay = (item: (typeof items)[number]) => {
    const when = eventById.get(item.last_event_id)?.occurred_at || item.updated_at;
    const t = Date.parse(when ?? "");
    return Number.isNaN(t) ? "" : istDate(new Date(t));
  };

  const matches = items.filter(
    (item) =>
      (!from || (lastDay(item) !== "" && lastDay(item) >= from)) &&
      (!to || (lastDay(item) !== "" && lastDay(item) <= to)) &&
      (!lateOnly || isLate(item)) &&
      (!statuses.length || statuses.includes(item.status)) &&
      (!hubIds.length || hubIds.includes(item.current_hub)) &&
      (!cities.length || cities.includes(hubCity.get(item.current_hub) ?? "")) &&
      (!holder || item.current_holder === holder) &&
      (!q ||
        (item.item_id ?? "").toLowerCase().includes(q) ||
        (item.prism_no ?? "").toLowerCase().includes(q) ||
        (item.brand ?? "").toLowerCase().includes(q) ||
        (item.model ?? "").toLowerCase().includes(q) ||
        (item.attributes ?? "").toLowerCase().includes(q))
  );

  const pages = Math.max(
    1,
    Math.ceil(matches.length / PAGE_SIZE)
  );

  const page = Math.min(validPage, pages);

  const shown = matches.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const sortedHubs = [...hubs].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const activeHubs = sortedHubs.filter(
    (h) => h.active !== "false"
  );

  const pageLink = (p: number) => {
    const params = new URLSearchParams({
      ...(q && { q }),
      ...(status && { status }),
      ...(hub && { hub }),
      ...(city && { city }),
      ...(from && { from }),
      ...(to && { to }),
      ...(holder && { holder }),
      ...(lateOnly && { late: "1" }),
      ...(type && { type }),
      page: String(p),
    });

    return `/inventory?${params}`;
  };

  // Rigs view (Rigs switch on, or a login that only sees rigs): a short table with only
  // Date, Rig ID / Asset Tag, Home hub, Brand, Model and Penalty amount. SD cards keep every column.
  const rigView = type === "rig" || !canSeeType(user.role, "sd_card");

  // Includes optional Admin checkbox and holder-specific Since column.
  const columnCount = mobileView
    ? 12 + (isAdmin ? 1 : 0)
    : rigView
    ? 6 + (isAdmin ? 1 : 0)
    : 16 + (isAdmin ? 1 : 0) + (holder ? 1 : 0) + (showQc ? 1 : 0);

  const table = (
    <div
      role="region"
      aria-label="Inventory table"
      tabIndex={0}
      style={{
        width: "100%",
        maxWidth: "100%",
        overflowX: "auto",
      }}
    >
      <table className={styles.table}>
        <thead>
          {mobileView ? (
            <tr>
              {isAdmin && <th scope="col" aria-label="Select items" />}
              <th scope="col">Date</th>
              <th scope="col">IMEI</th>
              <th scope="col">Asset Tag</th>
              <th scope="col">Serial</th>
              <th scope="col">Model</th>
              <th scope="col">Model No.</th>
              <th scope="col">Category</th>
              <th scope="col">Manufacturer</th>
              <th scope="col">Storage</th>
              <th scope="col">Cost</th>
              <th scope="col">Status</th>
              <th scope="col">Hub</th>
            </tr>
          ) : rigView ? (
            <tr>
              {isAdmin && <th scope="col" aria-label="Select items" />}
              <th scope="col">Date</th>
              <th scope="col">Rig ID / Asset Tag</th>
              <th scope="col">Home hub</th>
              <th scope="col">Brand</th>
              <th scope="col">Model</th>
              <th scope="col">Penalty amount</th>
            </tr>
          ) : (
          <tr>
            {isAdmin && (
              <th scope="col" aria-label="Select items" />
            )}

            <th scope="col">Date</th>
            <th scope="col">Items</th>
            <th scope="col">Serial</th>
            <th scope="col">Prism no.</th>
            <th scope="col">Brand</th>
            <th scope="col">Model</th>
            <th scope="col">Storage</th>
            <th scope="col">Card type</th>
            <th scope="col">Price / Penalty</th>
            <th scope="col">Attributes</th>
            <th scope="col">Status</th>
            {showQc && <th scope="col">QC</th>}
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Current hub</th>
            <th scope="col">Holder</th>
            {holder && <th scope="col">Since</th>}
            <th scope="col">Home hub</th>
          </tr>
          )}
        </thead>

        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={columnCount} className={styles.muted}>
                No items match the selected filters.
              </td>
            </tr>
          ) : (
            shown.map((item) => {
              const isMobile = item.item_type === "mobile";
              const card = readCardDetails(item.attributes);
              // Mobiles under All items: storage from their own details, no prism or card colour.
              const storage = isMobile ? mobileDetails(item.attributes)["Storage"] || "Not set" : card.storage;
              const cardType = isMobile ? "—" : card.cardType;

              const itemUrl =
                `/inventory/${encodeURIComponent(item.item_id)}`;

              // From / To of the latest movement (send, receive or correction).
              const last = eventById.get(item.last_event_id);

              const fromHub = last?.from_hub
                ? (hubName.get(last.from_hub) ?? last.from_hub)
                : "";

              const toHub = last?.hub
                ? (hubName.get(last.hub) ?? last.hub)
                : "";

              if (mobileView) {
                const when = last?.occurred_at || item.updated_at;
                const a = mobileDetails(item.attributes);
                return (
                  <tr key={item.item_id}>
                    {isAdmin && (
                      <td>
                        <input type="checkbox" name="ids" value={item.item_id} aria-label={`Select ${item.item_id}`} />
                      </td>
                    )}
                    <td style={{ whiteSpace: "nowrap" }}>{when ? `${formatIst(when)} IST` : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <Link href={itemUrl}>{item.item_id}</Link>
                      {isAdmin && (
                        <div style={{ marginTop: 8 }}>
                          <Link
                            href={`${itemUrl}/delete`}
                            aria-label={`Delete item ${item.item_id}`}
                            style={{
                              display: "inline-block",
                              padding: "5px 10px",
                              border: "1px solid #b91c1c",
                              borderRadius: 6,
                              color: "#b91c1c",
                              backgroundColor: "#fff7f7",
                              fontWeight: 600,
                              textDecoration: "none",
                            }}
                          >
                            Delete
                          </Link>
                        </div>
                      )}
                    </td>
                    <td>{a["Asset Tag"] || "—"}</td>
                    <td>{a["Serial"] || "—"}</td>
                    <td>{item.model || "—"}</td>
                    <td>{a["Model No."] || "—"}</td>
                    <td>{a["Category"] || "—"}</td>
                    <td>{item.brand || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{a["Storage"] || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{displayAmount(item.price)}</td>
                    <td>{STATUS_LABELS[item.status] ?? item.status}</td>
                    <td>{hubName.get(item.current_hub) ?? item.current_hub}</td>
                  </tr>
                );
              }

              if (rigView) {
                const when = last?.occurred_at || item.updated_at;
                return (
                  <tr key={item.item_id} style={rowTint(item.item_type)}>
                    {isAdmin && (
                      <td>
                        <input type="checkbox" name="ids" value={item.item_id} aria-label={`Select ${item.item_id}`} />
                      </td>
                    )}
                    <td style={{ whiteSpace: "nowrap" }}>{when ? `${formatIst(when)} IST` : "—"}</td>
                    <td>
                      <Link href={itemUrl}>{item.item_id}</Link>
                      {isAdmin && (
                        <div style={{ marginTop: 8 }}>
                          <Link
                            href={`${itemUrl}/delete`}
                            aria-label={`Delete item ${item.item_id}`}
                            style={{
                              display: "inline-block",
                              padding: "5px 10px",
                              border: "1px solid #b91c1c",
                              borderRadius: 6,
                              color: "#b91c1c",
                              backgroundColor: "#fff7f7",
                              fontWeight: 600,
                              textDecoration: "none",
                            }}
                          >
                            Delete
                          </Link>
                        </div>
                      )}
                    </td>
                    <td>{hubName.get(item.home_hub) ?? item.home_hub}</td>
                    <td>{item.brand || "—"}</td>
                    <td>{item.model || "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{displayAmount(item.price)}</td>
                  </tr>
                );
              }

              return (
                <tr key={item.item_id} style={rowTint(item.item_type)}>
                  {isAdmin && (
                    <td>
                      <input
                        type="checkbox"
                        name="ids"
                        value={item.item_id}
                        aria-label={`Select ${item.item_id}`}
                      />
                    </td>
                  )}

                  {/* Date: when this item last moved (send, receive, correction or add). */}
                  <td style={{ whiteSpace: "nowrap" }}>
                    {last?.occurred_at || item.updated_at
                      ? `${formatIst(last?.occurred_at || item.updated_at)} IST`
                      : "—"}
                  </td>

                  <td>
                    <TypeBadge type={item.item_type} />
                  </td>

                  <td>
                    <Link href={itemUrl}>
                      {item.item_id}
                    </Link>

                    {/* Delete stays Admin-only.
                        Opens confirmation; does not delete directly. */}
                    {isAdmin && (
                      <div style={{ marginTop: 8 }}>
                        <Link
                          href={`${itemUrl}/delete`}
                          aria-label={`Delete item ${item.item_id}`}
                          style={{
                            display: "inline-block",
                            padding: "5px 10px",
                            border: "1px solid #b91c1c",
                            borderRadius: 6,
                            color: "#b91c1c",
                            backgroundColor: "#fff7f7",
                            fontWeight: 600,
                            textDecoration: "none",
                          }}
                        >
                          Delete
                        </Link>
                      </div>
                    )}
                  </td>

                  <td>{isMobile ? "—" : item.prism_no}</td>
                  <td>{item.brand}</td>
                  <td>{item.model}</td>

                  <td style={{ whiteSpace: "nowrap" }}>
                    {storage}
                  </td>

                  <td>{cardType}</td>

                  <td style={{ whiteSpace: "nowrap" }}>
                    {displayAmount(item.price)}
                  </td>

                  <td>{formatAttributes(item.attributes)}</td>

                  <td>
                    {STATUS_LABELS[item.status] ?? item.status}
                  </td>

                  {showQc && (
                    <td style={{ whiteSpace: "nowrap", fontWeight: 600, color: QC_COLOR[latestQc.get(item.item_id) ?? ""] }}>
                      {item.item_type === "rig"
                        ? QC_LABELS[latestQc.get(item.item_id) ?? "qc_pending"]
                        : "—"}
                    </td>
                  )}

                  <td>
                    {last?.from_person || fromHub ? (
                      <>
                        {last?.from_person || "—"}
                        {fromHub && (
                          <div className={styles.muted}>
                            {fromHub}
                          </div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td>
                    {last?.to_person || toHub ? (
                      <>
                        {last?.to_person || "—"}
                        {toHub && (
                          <div className={styles.muted}>
                            {toHub}
                          </div>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td>
                    {hubName.get(item.current_hub) ??
                      item.current_hub}
                  </td>

                  <td>
                    {personName.get(item.current_holder) ??
                      item.current_holder}
                  </td>

                  {holder && (
                    <td>{formatIst(item.updated_at)}</td>
                  )}

                  <td>
                    {hubName.get(item.home_hub) ?? item.home_hub}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link>
      </p>

      {/* No logo on Inventory. Keep the logo in the receipt page only. */}
      <div className={styles.pageHead}>
        <h1>Inventory</h1>
      </div>

      <TypeSwitch
        role={user.role}
        current={type}
        path="/inventory"
        params={{ q: one(sp.q), status, hub, city, from, to, holder, late: lateOnly ? "1" : "" }}
      />

      {one(sp.done) && (
        <p className={styles.ok}>
          Updated {one(sp.done)} item(s)
          {Number(one(sp.same)) > 0 &&
            `, ${one(sp.same)} already in that state`}
          .
        </p>
      )}

      {isAdmin && one(sp.deleted) && (
        <p className={styles.ok}>
          Deleted {one(sp.deleted)} and its associated event history.
        </p>
      )}

      {one(sp.error) && (
        <p className={styles.error}>{one(sp.error)}</p>
      )}

      {/* CHANGED: Add item is visible to Admin, IM and Rig. */}
      {canAdd && (
        <details
          className={styles.details}
          open={
            !!one(sp.added) ||
            !!one(sp.addError) ||
            undefined
          }
        >
          <summary>+ Add an SD card</summary>

          <p className={styles.muted}>
            For an item that isn&apos;t in the inventory yet.
            It starts in stock at the hub you choose, with its
            own history from today.
          </p>

          {one(sp.added) && (
            <p className={styles.ok}>
              Added {one(sp.added)}.{" "}
              <Link
                href={`/inventory/${encodeURIComponent(
                  one(sp.added)
                )}`}
              >
                View it
              </Link>
              , or add another below.
            </p>
          )}

          {one(sp.addError) && (
            <p className={styles.error}>
              {one(sp.addError)}
            </p>
          )}

          <AddCardForm hubs={activeHubs} />
        </details>
      )}

      {/* Add many items at once: one home hub, many serials. */}
      {canAdd && (
        <details className={styles.details}>
          <summary>+ Add multiple SD cards</summary>

          <p className={styles.muted}>
            Scan or paste several Serial / Asset Tags. Details load
            automatically for each one. All items start in stock at the
            home hub you choose.
          </p>

          <BulkAddForm hubs={activeHubs} />
        </details>
      )}

      {/* Add a rig: Admin and IM. Details load from the rig sheet. */}
      {canAddRig && (
        <details
          className={styles.details}
          open={type === "rig" && (!!one(sp.added) || !!one(sp.addError)) ? true : undefined}
        >
          <summary>+ Add a rig</summary>

          <p className={styles.muted}>
            For a rig that isn&apos;t in the inventory yet. It starts in stock
            at Bangalore, with QC pending.
          </p>

          {type === "rig" && one(sp.added) && (
            <p className={styles.ok}>
              Added rig {one(sp.added)}.{" "}
              <Link href={`/inventory/${encodeURIComponent(one(sp.added))}`}>View it</Link>
              , or add another below.
            </p>
          )}

          {type === "rig" && one(sp.addError) && (
            <p className={styles.error}>{one(sp.addError)}</p>
          )}

          <RigAddForm homeHub={rigHomeHub(hubs)} />
        </details>
      )}

      {/* Add many rigs at once: Admin and IM. Home hub Bangalore, details from the rig sheet. */}
      {canAddRig && (
        <details className={styles.details}>
          <summary>+ Add multiple rigs</summary>
          <p className={styles.muted}>
            Scan or paste many rig IDs. Brand, model and penalty load from the rig sheet. Every rig starts in
            stock at Bangalore, with QC pending.
          </p>
          <RigBulkAddForm homeHubName={rigHomeHub(hubs)?.name} />
        </details>
      )}

      {/* Add a mobile: Admin and IM. Scan the IMEI; details load from the mobile sheet. */}
      {canAddMobile && (
        <details className={styles.details} open={mobileView && (one(sp.added) || one(sp.addError)) ? true : undefined}>
          <summary>+ Add a mobile</summary>

          <p className={styles.muted}>
            Scan the QR code on the phone (IMEI). Asset Tag, Serial, Model, Model No., Category, Manufacturer,
            Storage and Cost load from the mobile sheet. Every mobile starts in stock at Instawork Robotics Labs.
          </p>

          {mobileView && one(sp.added) && (
            <p className={styles.ok}>
              Added mobile {one(sp.added)}.{" "}
              <Link href={`/inventory/${encodeURIComponent(one(sp.added))}`}>View it</Link>
              , or add another below.
            </p>
          )}

          {mobileView && one(sp.addError) && <p className={styles.error}>{one(sp.addError)}</p>}

          <MobileAddForm homeHubName={mobileHomeHub(hubs)?.name} />
        </details>
      )}

      {/* Add many mobiles at once: Admin and IM. Scan QR codes one after another. */}
      {canAddMobile && (
        <details className={styles.details}>
          <summary>+ Add multiple mobiles</summary>
          <p className={styles.muted}>
            Scan the QR codes one after another (one per line), or paste IMEIs. Details load from the mobile sheet.
            Every mobile starts in stock at Instawork Robotics Labs.
          </p>
          <MobileBulkAddForm homeHubName={mobileHomeHub(hubs)?.name} />
        </details>
      )}

      <form className={styles.row} method="get">
        {type && <input type="hidden" name="type" value={type} />}
        <input
          name="q"
          defaultValue={one(sp.q)}
          placeholder="Search serial, prism no., brand, model or attributes"
          aria-label="Search inventory"
        />

        <MultiSelect
          name="status"
          label="Status"
          allLabel="All statuses"
          options={STATUSES.map((st) => ({ value: st, label: STATUS_LABELS[st] }))}
          selected={statuses}
        />

        <MultiSelect
          name="city"
          label="City"
          allLabel="All cities"
          options={cityOptions}
          selected={cities}
        />

        <MultiSelect
          name="hub"
          label="Hub"
          allLabel="All hubs"
          options={sortedHubs.map((h) => ({ value: h.hub_id, label: h.name }))}
          selected={hubIds}
        />

        {/* Date range on each item's last movement (IST). */}
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <strong style={{ fontWeight: 600 }}>From</strong>
          <input type="date" name="from" defaultValue={from} max={to || undefined} aria-label="From date" />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <strong style={{ fontWeight: 600 }}>To</strong>
          <input type="date" name="to" defaultValue={to} min={from || undefined} aria-label="To date" />
        </label>

        {holder && (
          <input type="hidden" name="holder" value={holder} />
        )}

        {lateOnly && (
          <>
            <input type="hidden" name="late" value="1" />
            <span className={styles.muted}>
              Late items only (over {LATE_AFTER_HOURS} hours) ·{" "}
              <Link href="/inventory">clear</Link>
            </span>
          </>
        )}

        <button type="submit">Filter</button>

        {(statuses.length > 0 || cities.length > 0 || hubIds.length > 0 || from || to || q) && (
          <Link href={type ? `/inventory?type=${type}` : "/inventory"}>Clear filters</Link>
        )}

        {holder && (
          <span className={styles.muted}>
            Holder:{" "}
            {people.find((p) => p.person_id === holder)?.name ??
              holder}{" "}
            · <Link href="/inventory">clear</Link>
          </span>
        )}
      </form>

      <p className={styles.muted}>
        {matches.length} of {items.length} items. Showing{" "}
        {shown.length ? (page - 1) * PAGE_SIZE + 1 : 0}–
        {(page - 1) * PAGE_SIZE + shown.length}.
      </p>

      {!rigView && !mobileView && (
        <p className={styles.muted}>
          Storage and card type come from saved item attributes.
          Price / Penalty shows the saved amount, not an automatic
          charge. Missing values show “Not set”.
        </p>
      )}

      {/* Corrections and selection checkboxes remain Admin-only. */}
      {isAdmin ? (
        <form action={applyCorrection} className={styles.list}>
          <input
            type="hidden"
            name="back"
            value="/inventory"
          />

          <CorrectionPanel
            hubs={hubs}
            people={people}
            showScan
          />

          {table}
        </form>
      ) : (
        table
      )}

      <div className={styles.row}>
        {page > 1 && (
          <Link href={pageLink(page - 1)}>← Previous</Link>
        )}

        <span className={styles.muted}>
          Page {page} of {pages}
        </span>

        {page < pages && (
          <Link href={pageLink(page + 1)}>Next →</Link>
        )}
      </div>
    </main>
  );
}
import Link from "next/link";
import { formatAttributes } from "@/lib/attributes";
import { requireRole } from "@/lib/authz";
import { LATE_AFTER_HOURS } from "@/lib/dashboard";
import { STATUS_LABELS, one } from "@/lib/labels";
import { STATUSES, type Status } from "@/lib/schema";
import { getStore } from "@/lib/store";
import { formatIst } from "@/lib/time";
import styles from "../admin/admin.module.css";
import AddCardForm from "./AddCardForm";
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
  const canAdd =
    user.role === "admin" ||
    user.role === "im" ||
    user.role === "rig";

  const sp = await searchParams;
  const q = one(sp.q).trim().toLowerCase();

  const status = one(sp.status);
  const statuses = status.split(",").filter(Boolean);

  const hub = one(sp.hub);
  const hubIds = hub.split(",").filter(Boolean);

  const holder = one(sp.holder);
  const lateOnly = one(sp.late) === "1";
  const requestedPage = Number(one(sp.page));

  const validPage =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;

  const store = getStore();

  const [items, hubs, people, events] = await Promise.all([
    store.list("items"),
    store.list("hubs"),
    store.list("people"),
    store.list("events"),
  ]);

  // Each item's latest movement, used for the From / To columns.
  const eventById = new Map(
    events.map((e) => [e.event_id, e])
  );

  const hubName = new Map(
    hubs.map((h) => [h.hub_id, h.name])
  );

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

  const matches = items.filter(
    (item) =>
      (!lateOnly || isLate(item)) &&
      (!statuses.length || statuses.includes(item.status)) &&
      (!hubIds.length || hubIds.includes(item.current_hub)) &&
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
      ...(holder && { holder }),
      ...(lateOnly && { late: "1" }),
      page: String(p),
    });

    return `/inventory?${params}`;
  };

  // Includes optional Admin checkbox and holder-specific Since column.
  const columnCount =
    14 + (isAdmin ? 1 : 0) + (holder ? 1 : 0);

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
          <tr>
            {isAdmin && (
              <th scope="col" aria-label="Select items" />
            )}

            <th scope="col">Serial</th>
            <th scope="col">Prism no.</th>
            <th scope="col">Brand</th>
            <th scope="col">Model</th>
            <th scope="col">Storage</th>
            <th scope="col">Card type</th>
            <th scope="col">Price / Penalty</th>
            <th scope="col">Attributes</th>
            <th scope="col">Status</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Current hub</th>
            <th scope="col">Holder</th>
            {holder && <th scope="col">Since</th>}
            <th scope="col">Home hub</th>
          </tr>
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
              const { storage, cardType } = readCardDetails(
                item.attributes
              );

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

              return (
                <tr key={item.item_id}>
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

                  <td>{item.prism_no}</td>
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
          <summary>+ Add an item</summary>

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
          <summary>+ Add multiple items</summary>

          <p className={styles.muted}>
            Scan or paste several Serial / Asset Tags. Details load
            automatically for each one. All items start in stock at the
            home hub you choose.
          </p>

          <BulkAddForm hubs={activeHubs} />
        </details>
      )}

      <form className={styles.row} method="get">
        <input
          name="q"
          defaultValue={one(sp.q)}
          placeholder="Search serial, prism no., brand, model or attributes"
          aria-label="Search inventory"
        />

        {statuses.length > 1 ? (
          <>
            <input type="hidden" name="status" value={status} />
            <span className={styles.muted}>
              Status:{" "}
              {statuses
                .map((s) => STATUS_LABELS[s as Status] ?? s)
                .join(" or ")}{" "}
              · <Link href="/inventory">clear</Link>
            </span>
          </>
        ) : (
          <select
            name="status"
            defaultValue={status}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        )}

        {hubIds.length > 1 ? (
          <>
            <input type="hidden" name="hub" value={hub} />
            <span className={styles.muted}>
              Hubs:{" "}
              {hubIds
                .map((id) => hubName.get(id) ?? id)
                .join(", ")}{" "}
              · <Link href="/inventory">clear</Link>
            </span>
          </>
        ) : (
          <select
            name="hub"
            defaultValue={hub}
            aria-label="Hub"
          >
            <option value="">All hubs</option>
            {sortedHubs.map((h) => (
              <option key={h.hub_id} value={h.hub_id}>
                {h.name}
              </option>
            ))}
          </select>
        )}

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

      <p className={styles.muted}>
        Storage and card type come from saved item attributes.
        Price / Penalty shows the saved amount, not an automatic
        charge. Missing values show “Not set”.
      </p>

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
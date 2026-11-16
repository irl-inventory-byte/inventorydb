import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { allowedTypes, storeForAll, type ItemType } from "@/lib/access";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import { OUT_STATUSES, type ItemEvent, type Role, type Status } from "@/lib/schema";
import { hubCityMap, manyValues, matchesMove, moveFilterOptions, pickRange } from "@/lib/daily-moves";
import { formatIst, istDate } from "@/lib/time";
import styles from "../dashboard.module.css";
import BackLink from "../BackLink";
import { n } from "../charts";

const TYPE_LABELS: Record<string, string> = {
  sd_card: "SD cards",
  rig: "Rigs",
  mobile: "Mobiles",
  power_bank: "Power Banks",
};

// "Sent, but not received yet" = every OUT_STATUSES status (with_fo, traveling, with_rig, with_internal,
// pending), plus the two rig-only "sent to QC/hardware, not received" states — OUT_STATUSES alone doesn't
// cover those two.
const AWAITING_RECEIPT: readonly Status[] = [...OUT_STATUSES, "pending_qc", "pending_hardware"];

interface NotReceivedRow {
  item_id: string;
  item_type: string;
  sentBy: string;
  sentTo: string;
  role: string;
  roleKey: string;
  city: string;
  homeHub: string; // the FO/IFO's own base hub (People sheet), not where this item currently sits
  mobile: string;
  sentAt: string;
  hoursOut: number | null; // for sorting and for the "Out for" column; null when the send time is unknown
  outFor: string;
  status: string;
}

/** "3 hours" / "2 days", same wording as the main dashboard's "Needs attention" table. */
function howLong(hours: number): string {
  return hours < 48 ? `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? "" : "s"}` : `${Math.floor(hours / 24)} days`;
}

/**
 * EVENTS: every send and receive in a date range, with a City and Role filter — how many of each item
 * type were sent / received, and which sent items haven't been received yet (FO / IFO shown first,
 * since they're the ones most likely to be chased).
 */
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole();
  const sp = await searchParams;
  const now = new Date();

  // Every item type this login can see, not just the one the dashboard tab is currently on.
  const store = storeForAll(user.role);
  const [items, events, hubs, people] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("hubs"),
    store.list("people"),
  ]);

  // ?efrom=&eto=: default to just today. ?ecity=&erole=: one value each (a plain <select>).
  const range = pickRange(one(sp.efrom), one(sp.eto), now, 1);
  const cityFilter = manyValues(sp.ecity as string | string[] | undefined);
  const roleFilter = manyValues(sp.erole as string | string[] | undefined);

  const city = hubCityMap(hubs);
  const roleOf = new Map(people.map((p) => [p.person_id, p.role as string]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));
  const personById = new Map(people.map((p) => [p.person_id, p]));
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const itemById = new Map(items.map((i) => [i.item_id, i]));

  // Choices for the City / Role dropdowns: only ones that actually appear in this date range's events.
  const options = moveFilterOptions(events, hubs, people, range);

  const inRange = (e: ItemEvent): boolean => {
    const t = Date.parse(e.occurred_at);
    if (Number.isNaN(t)) return false;
    const day = istDate(new Date(t));
    return day >= range.from && day <= range.to;
  };
  const matches = (e: ItemEvent): boolean =>
    inRange(e) && matchesMove(e, { city: cityFilter, role: roleFilter }, city, roleOf);

  // 1 + 2. Counts per item type: how many checked out / received in this range, after the filters.
  const types = allowedTypes(user.role) as readonly ItemType[];
  const counts = Object.fromEntries(types.map((t) => [t, { sent: 0, received: 0 }])) as Record<
    ItemType,
    { sent: number; received: number }
  >;
  for (const e of events) {
    if (!matches(e)) continue;
    if (e.action !== "check_out" && e.action !== "receive") continue;
    const item = itemById.get(e.item_id);
    const t = item?.item_type as ItemType | undefined;
    if (!t || !counts[t]) continue;
    if (e.action === "check_out") counts[t].sent++;
    else counts[t].received++;
  }
  const totalSent = Object.values(counts).reduce((s, c) => s + c.sent, 0);
  const totalReceived = Object.values(counts).reduce((s, c) => s + c.received, 0);

  // 3. Items checked out in this range that haven't been received yet: the item's LAST event is still
  // that same check-out (nothing has happened to it since — a later receive, or a later send, would
  // have moved last_event_id on), and its current status is one of the "awaiting receipt" states.
  const checkoutsInRange = events.filter((e) => e.action === "check_out" && matches(e));
  const checkoutEventIds = new Set(checkoutsInRange.map((e) => e.event_id));
  const checkoutByItem = new Map(checkoutsInRange.map((e) => [e.item_id, e]));
  const notReceived = items.filter(
    (i) => checkoutEventIds.has(i.last_event_id) && (AWAITING_RECEIPT as readonly string[]).includes(i.status),
  );

  const notReceivedRows: NotReceivedRow[] = notReceived
    .map((i) => {
      const sendEvent = checkoutByItem.get(i.item_id);
      const holder = personById.get(i.current_holder);
      const holderRole = holder?.role ?? roleOf.get(i.current_holder) ?? "";
      const sentAtMs = sendEvent ? Date.parse(sendEvent.occurred_at) : NaN;
      const hoursOut = Number.isNaN(sentAtMs) ? null : Math.max(0, (now.getTime() - sentAtMs) / 3_600_000);
      return {
        item_id: i.item_id,
        item_type: TYPE_LABELS[i.item_type] ?? i.item_type,
        sentBy: sendEvent?.from_person || "—",
        sentTo: personName.get(i.current_holder) || sendEvent?.to_person || "—",
        role: ROLE_LABELS[holderRole as Role] ?? (holderRole || "—"),
        roleKey: holderRole,
        city: city.get(i.current_hub) ?? i.current_hub ?? "—",
        homeHub: holder?.hub ? (hubName.get(holder.hub) ?? holder.hub) : "—",
        mobile: holder?.mobile?.trim() || "—",
        sentAt: sendEvent ? formatIst(sendEvent.occurred_at) : "—",
        hoursOut,
        outFor: hoursOut === null ? "—" : howLong(hoursOut),
        status: STATUS_LABELS[i.status] ?? i.status,
      };
    })
    .sort((a, b) => (b.hoursOut ?? -1) - (a.hoursOut ?? -1));

  const foIfoNotReceived = notReceivedRows.filter((r) => r.roleKey === "fo" || r.roleKey === "ifo");
  const otherNotReceived = notReceivedRows.filter((r) => r.roleKey !== "fo" && r.roleKey !== "ifo");

  const filtersActive = Boolean(one(sp.efrom) || one(sp.eto) || cityFilter.length || roleFilter.length);

  return (
    <div className={styles.root}>
      <main className={styles.wrap}>
        <p className={styles.back}>
          <BackLink />
        </p>
        <h1>Events</h1>
        <p className={styles.muted}>
          Every send and receive, {range.from === range.to ? `on ${range.from}` : `from ${range.from} to ${range.to}`}
          {range.cut && " (range shortened to the last 92 days)"}.
        </p>

        <form method="get" className={styles.filters} style={{ margin: "8px 0 16px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
            From
            <input type="date" name="efrom" defaultValue={range.from} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem" }}>
            To
            <input type="date" name="eto" defaultValue={range.to} />
          </label>
          <select name="ecity" defaultValue={cityFilter[0] ?? ""} aria-label="City">
            <option value="">All cities</option>
            {options.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select name="erole" defaultValue={roleFilter[0] ?? ""} aria-label="Role">
            <option value="">All roles</option>
            {options.roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r as Role] ?? r}
              </option>
            ))}
          </select>
          <button type="submit">Apply</button>
          {filtersActive && (
            <Link href="/dashboard/events" className={styles.link}>
              Reset
            </Link>
          )}
        </form>

        <section className={styles.card} aria-label="Counts by item type">
          <h2>Sent &amp; received</h2>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Item type</th>
                  <th scope="col" className={styles.num}>
                    Sent
                  </th>
                  <th scope="col" className={styles.num}>
                    Received
                  </th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <tr key={t}>
                    <td>{TYPE_LABELS[t] ?? t}</td>
                    <td className={styles.num}>{n(counts[t]?.sent ?? 0)}</td>
                    <td className={styles.num}>{n(counts[t]?.received ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className={styles.num}>{n(totalSent)}</td>
                  <td className={styles.num}>{n(totalReceived)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section className={styles.card} aria-label="Not received yet">
          <div className={styles.sectionHead}>
            <h2>Sent, not received yet</h2>
            <span className={styles.muted}>
              {n(notReceivedRows.length)} item{notReceivedRows.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className={styles.muted}>
            Items checked out in this date range that still haven&apos;t been received — FO and IFO first, then
            everyone else (rig team, internal, hubs waiting to receive).
          </p>
          {notReceivedRows.length === 0 ? (
            <p className={styles.ok}>Everything sent in this range has been received.</p>
          ) : (
            <>
              {foIfoNotReceived.length > 0 && (
                <>
                  <h3 style={{ margin: "6px 0 0", fontSize: "0.95rem" }}>With FO / IFO ({foIfoNotReceived.length})</h3>
                  <p className={styles.muted} style={{ margin: "2px 0 0", fontSize: "0.82rem" }}>
                    Longest-out first — mobile number and base hub included so they're easy to chase.
                  </p>
                  <NotReceivedTable rows={foIfoNotReceived} showContact />
                </>
              )}
              {otherNotReceived.length > 0 && (
                <>
                  <h3 style={{ margin: "14px 0 0", fontSize: "0.95rem" }}>Everyone else ({otherNotReceived.length})</h3>
                  <NotReceivedTable rows={otherNotReceived} />
                </>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function NotReceivedTable({ rows, showContact = false }: { rows: NotReceivedRow[]; showContact?: boolean }) {
  return (
    <div className={styles.tableScroll} style={{ marginTop: 8 }}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Type</th>
            <th scope="col">Sent by</th>
            <th scope="col">Sent to</th>
            <th scope="col">Role</th>
            {showContact && <th scope="col">Mobile</th>}
            {showContact && <th scope="col">Base hub</th>}
            <th scope="col">City</th>
            <th scope="col">Sent at</th>
            <th scope="col">Out for</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item_id}>
              <td>
                <Link href={`/inventory/${encodeURIComponent(r.item_id)}`} className={styles.link}>
                  {r.item_id}
                </Link>
              </td>
              <td>{r.item_type}</td>
              <td>{r.sentBy}</td>
              <td>{r.sentTo}</td>
              <td>{r.role}</td>
              {showContact && (
                <td>
                  {r.mobile !== "—" ? (
                    <a href={`tel:${r.mobile}`} className={styles.link}>
                      {r.mobile}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              )}
              {showContact && <td>{r.homeHub}</td>}
              <td>{r.city}</td>
              <td>{r.sentAt}</td>
              <td>{r.outFor}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { QC_LABELS, ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import { OUT_STATUSES, type Acknowledgment, type HardwareUpdate, type Item, type QcCheck, type Status } from "@/lib/schema";
import { MY_DASHBOARD_ROLES, RECEIVE_ROLES, storeFor } from "@/lib/access";
import { formatIst } from "@/lib/time";
import styles from "../dashboard.module.css";

// Statuses in which an item is in someone's hands (QC and hardware hold rigs too).
const HELD_STATUSES: readonly Status[] = [...OUT_STATUSES, "with_qc", "with_hardware"];

const QC_COLOR: Record<string, string> = { pass: "#15803D", repaired: "#15803D", fail: "#B42318", qc_pending: "#8A4B00" };

// Activity records displayed per page.
const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  check_out: "Sent",
  check_in: "Checked in",
  receive: "Received",
  report_lost: "Reported lost",
  report_damaged: "Reported damaged",
  retire: "Retired",
  reassign_home_hub: "Changed home hub",
  correct: "Corrected",
  import: "Imported",
};

/**
 * One line of a card's breakdown: the rig (IC number) and the details needed to
 * recognise it without opening the item page.
 */
interface DetailRow {
  key: string;
  itemId: string;
  prism: string;
  brand: string;
  model: string;
  status: string;
  qc: string;
  where: string;
  when: string;
  note: string;
}

/**
 * A summary card. `view` makes the card clickable: the rigs behind the number are
 * listed under the cards when ?view= matches.
 */
interface Metric {
  label: string;
  value: string;
  view?: string;
  rows?: DetailRow[];
  /** Heading for the breakdown, when the card label doesn't read well as one. */
  rowsTitle?: string;
  /** What `when` holds for this card, e.g. "Recorded at". */
  whenLabel?: string;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function numberText(value: number): string {
  return value.toLocaleString("en-IN");
}

// Avoid displaying invalid dates.
function displayTime(value: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return "—";
  }

  return formatIst(value);
}

function eventTime(recordedAt: string, occurredAt: string): number {
  const recorded = Date.parse(recordedAt);

  if (Number.isFinite(recorded)) {
    return recorded;
  }

  const occurred = Date.parse(occurredAt);
  return Number.isFinite(occurred) ? occurred : 0;
}

export default async function MyDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string | string[];
    view?: string | string[];
  }>;
}) {
  // Authenticate and authorize on the server.
  const user = await requireRole(...MY_DASHBOARD_ROLES);
  const isQc = user.role === "qc";
  const isHardware = user.role === "hardware";
  const canReceive = RECEIVE_ROLES.includes(user.role);
  const email = normalizeEmail(user.email ?? "");

  // Never match an empty login email to blank event records.
  if (!email) {
    return (
      <div className={styles.root}>
        <main className={styles.wrap}>
          <p className={styles.back}>
            <Link href="/">← Home</Link>
          </p>

          <h1>My dashboard</h1>

          <p className={styles.warn}>
            Your login has no email address. Please sign out and
            sign in again.
          </p>
        </main>
      </div>
    );
  }

  const sp = await searchParams;
  const store = storeFor(user.role);

  const [events, items, people, hubs, users, qcChecks, hardwareUpdates, acknowledgments] = await Promise.all([
    store.list("events"),
    store.list("items"),
    store.list("people"),
    store.list("hubs"),
    store.list("users"),
    isQc || isHardware ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
    isHardware ? store.list("hardware_updates") : Promise.resolve([] as HardwareUpdate[]),
    !isQc && !isHardware ? store.list("acknowledgments") : Promise.resolve([] as Acknowledgment[]),
  ]);

  // Latest QC result per rig (rows are oldest first, so the last one wins).
  const latestQc = new Map<string, string>();
  const latestQcAt = new Map<string, number>();
  for (const c of qcChecks) {
    latestQc.set(c.item_id, c.qc_status);
    const t = Date.parse(c.recorded_at);
    if (Number.isFinite(t)) latestQcAt.set(c.item_id, t);
  }

  // QC results and hardware updates this login recorded, newest first.
  const byMe = (v: string) => normalizeEmail(v ?? "") === email;
  const myQc = qcChecks.filter((c) => byMe(c.recorded_by)).reverse();
  const myHardware = hardwareUpdates.filter((h) => byMe(h.recorded_by)).reverse();

  const hubNames = new Map(
    hubs.map((hub) => [hub.hub_id, hub.name])
  );

  const personNames = new Map(
    people.map((person) => [person.person_id, person.name])
  );

  const itemById = new Map(items.map((item) => [item.item_id, item]));

  /*
   * PERSONAL ACTIVITY
   *
   * Filter before rendering or paginating.
   * recorded_by is expected to contain the recorder's login email.
   * from_id and to_id are not used to identify the recorder.
   */
  const myEvents = events
    .filter(
      (event) =>
        normalizeEmail(event.recorded_by ?? "") === email
    )
    .sort(
      (a, b) =>
        eventTime(b.recorded_at, b.occurred_at) -
        eventTime(a.recorded_at, a.occurred_at)
    );

  /*
   * PERSONAL HOLDINGS
   *
   * Resolve the person associated with the authenticated login.
   * Check both users.person_id and people.linked_user.
   * Conflicting links must be corrected rather than guessed.
   */
  const candidatePersonIds = new Set<string>();

  for (const account of users) {
    if (normalizeEmail(account.email ?? "") === email) {
      const id = (account.person_id ?? "").trim();

      if (id) {
        candidatePersonIds.add(id);
      }
    }
  }

  for (const person of people) {
    if (normalizeEmail(person.linked_user ?? "") === email) {
      const id = (person.person_id ?? "").trim();

      if (id) {
        candidatePersonIds.add(id);
      }
    }
  }

  // The live link (works for an Admin acting as QC / hardware too); otherwise the single match found here.
  const linkedPersonId =
    user.personId ||
    (candidatePersonIds.size === 1
      ? Array.from(candidatePersonIds)[0]
      : undefined);

  const matchingPersonRecords = linkedPersonId
    ? people.filter(
        (person) => person.person_id === linkedPersonId
      )
    : [];

  const linkedPerson =
    matchingPersonRecords.length === 1
      ? matchingPersonRecords[0]
      : undefined;


  // Holdings are current-state records, not historical activity.
  const myItems = linkedPerson
    ? items.filter(
        (item) =>
          item.current_holder === linkedPerson.person_id &&
          HELD_STATUSES.includes(item.status)
      )
    : [];

  /*
   * Each count is an item-event count.
   * Sending several cards in one batch may create several events.
   */
  const sentCount = myEvents.filter(
    (event) => event.action === "check_out"
  ).length;

  const receivedCount = myEvents.filter(
    (event) => event.action === "receive"
  ).length;

  /*
   * Acknowledgments of batches I sent (action = check_out, from_id = me): how many items the
   * receiver has confirmed they got in good condition, out of how many I sent in total.
   */
  const mySentAcks = linkedPersonId
    ? acknowledgments.filter((a) => a.action === "check_out" && a.from_id === linkedPersonId)
    : [];
  const sentItemsTotal = mySentAcks.reduce((sum, a) => sum + (Number(a.item_count) || 0), 0);
  const sentItemsAcked = mySentAcks
    .filter((a) => a.answer === "yes")
    .reduce((sum, a) => sum + (Number(a.item_count) || 0), 0);
  const sentItemsFlagged = mySentAcks
    .filter((a) => a.answer === "no")
    .reduce((sum, a) => sum + (Number(a.item_count) || 0), 0);

  /*
   * Cards still with me: their latest event is a receive I recorded
   * (I haven't sent them on since), plus any cards assigned to my
   * person record in an out status.
   */
  const eventById = new Map(
    events.map((event) => [event.event_id, event])
  );

  const withMeIds = new Set(myItems.map((item) => item.item_id));

  const withMeItems = [
    ...myItems,
    ...items.filter((item) => {
      if (withMeIds.has(item.item_id)) return false;
      const last = eventById.get(item.last_event_id);
      return (
        last?.action === "receive" &&
        normalizeEmail(last.recorded_by ?? "") === email
      );
    }),
  ];

  const correctionCount = myEvents.filter(
    (event) =>
      event.action === "correct" ||
      event.action === "reassign_home_hub"
  ).length;

  // Pagination includes only this user's recorded events.
  const requestedPage = Number(one(sp.page));

  const totalPages = Math.max(
    1,
    Math.ceil(myEvents.length / PAGE_SIZE)
  );

  const page = Math.min(
    totalPages,
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1
  );

  const shownEvents = myEvents.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  // Where this login sent rigs: to an IM (QC pass / repaired) or to the hardware team (QC fail).
  const sentToImEvents = myEvents.filter((e) => e.action === "check_out" && e.status_after === "pending");
  const sentToHardwareEvents = myEvents.filter((e) => e.action === "check_out" && e.status_after === "with_hardware");
  const sentToIm = sentToImEvents.length;
  const sentToHardware = sentToHardwareEvents.length;

  // A rig with me is waiting for QC when no result was recorded since it reached me.
  const waitingForQc = (item: (typeof items)[number]) => {
    const arrived = Date.parse(eventById.get(item.last_event_id)?.occurred_at ?? item.updated_at ?? "");
    const checked = latestQcAt.get(item.item_id);
    return checked === undefined || (Number.isFinite(arrived) && checked < arrived);
  };

  // Rigs sent to my team that nobody has received yet (Receive items shows the same list). Anyone in the
  // team can receive them, so the whole team's count is shown, with how many were sent to me by name.
  const teamWaiting = items.filter((i) => i.status === (isQc ? "pending_qc" : "pending_hardware"));
  const teamWaitingMine = linkedPerson ? teamWaiting.filter((i) => i.current_holder === linkedPerson.person_id) : [];
  const toReceive = teamWaiting.length;
  const toReceiveMine = teamWaitingMine.length;

  /*
   * BREAKDOWN ROWS
   *
   * Each card's number is turned into the rigs behind it, so clicking the card
   * shows the IC numbers and their details without a trip to another page.
   */

  // Where a rig is right now: the person holding it, else its hub.
  const whereOf = (item: Item | undefined) =>
    (item && (personNames.get(item.current_holder) ?? hubNames.get(item.current_hub) ?? item.current_hub)) || "—";

  const rowFromItem = (item: Item, extra?: { when?: string; note?: string }): DetailRow => ({
    key: item.item_id,
    itemId: item.item_id,
    prism: item.prism_no || "",
    brand: item.brand || "",
    model: item.model || "",
    status: STATUS_LABELS[item.status] ?? item.status,
    qc: latestQc.get(item.item_id) || "qc_pending",
    where: whereOf(item),
    when: extra?.when ?? (eventById.get(item.last_event_id)?.occurred_at || item.updated_at || ""),
    note: extra?.note ?? "",
  });

  // A row for a QC result or hardware update: the rig's details, plus when and what was written.
  const rowFromRecord = (
    id: string,
    itemId: string,
    when: string,
    note: string,
    qcOverride?: string,
  ): DetailRow => {
    const item = itemById.get(itemId);
    return {
      key: id,
      itemId,
      prism: item?.prism_no || "",
      brand: item?.brand || "",
      model: item?.model || "",
      status: item ? STATUS_LABELS[item.status] ?? item.status : "—",
      qc: qcOverride ?? latestQc.get(itemId) ?? "qc_pending",
      where: whereOf(item),
      when,
      note,
    };
  };

  const itemRows = (list: Item[]) => list.map((item) => rowFromItem(item));

  // Rigs this login sent on: the event says when and to whom.
  const sentRows = (list: typeof myEvents) =>
    list.map((event) => {
      const item = itemById.get(event.item_id);
      return {
        ...rowFromRecord(event.event_id, event.item_id, event.occurred_at || event.recorded_at, event.note || ""),
        where: event.to_person || whereOf(item),
      };
    });

  const qcRows = (list: QcCheck[]) =>
    list.map((c) => rowFromRecord(c.check_id, c.item_id, c.recorded_at, c.comment || "", c.qc_status));

  const hardwareRows = (list: HardwareUpdate[]) =>
    list.map((h) =>
      rowFromRecord(h.update_id, h.item_id, h.recorded_at, [h.update_type, h.comment].filter(Boolean).join(": ")),
    );

  const qcMetrics: Metric[] = [
    {
      label: "Waiting for the QC team to receive",
      value: numberText(toReceive),
      view: "to_receive",
      rows: itemRows(teamWaiting),
      rowsTitle: "Rigs sent to the QC team, not received yet",
      whenLabel: "Sent at",
    },
    {
      label: "Of these, sent to me",
      value: numberText(toReceiveMine),
      view: "to_receive_mine",
      rows: itemRows(teamWaitingMine),
      rowsTitle: "Rigs sent to me, not received yet",
      whenLabel: "Sent at",
    },
    {
      label: "Rigs with me",
      value: numberText(withMeItems.length),
      view: "with_me",
      rows: itemRows(withMeItems),
      rowsTitle: "Rigs currently with me",
      whenLabel: "Since",
    },
    {
      label: "Waiting for my QC result",
      value: numberText(withMeItems.filter(waitingForQc).length),
      view: "awaiting_qc",
      rows: itemRows(withMeItems.filter(waitingForQc)),
      rowsTitle: "Rigs with me that still need a QC result",
      whenLabel: "Since",
    },
    {
      label: "QC pass recorded",
      value: numberText(myQc.filter((c) => c.qc_status === "pass").length),
      view: "qc_pass",
      rows: qcRows(myQc.filter((c) => c.qc_status === "pass")),
      rowsTitle: "Rigs I passed",
      whenLabel: "Recorded at",
    },
    {
      label: "QC fail recorded",
      value: numberText(myQc.filter((c) => c.qc_status === "fail").length),
      view: "qc_fail",
      rows: qcRows(myQc.filter((c) => c.qc_status === "fail")),
      rowsTitle: "Rigs I failed",
      whenLabel: "Recorded at",
    },
    {
      label: "Sent to IM",
      value: numberText(sentToIm),
      view: "sent_im",
      rows: sentRows(sentToImEvents),
      rowsTitle: "Rigs I sent to an IM",
      whenLabel: "Sent at",
    },
    {
      label: "Sent to hardware team",
      value: numberText(sentToHardware),
      view: "sent_hardware",
      rows: sentRows(sentToHardwareEvents),
      rowsTitle: "Rigs I sent to the hardware team",
      whenLabel: "Sent at",
    },
  ];

  const hardwareMetrics: Metric[] = [
    {
      label: "Waiting for the hardware team to receive",
      value: numberText(toReceive),
      view: "to_receive",
      rows: itemRows(teamWaiting),
      rowsTitle: "Rigs sent to the hardware team, not received yet",
      whenLabel: "Sent at",
    },
    {
      label: "Of these, sent to me",
      value: numberText(toReceiveMine),
      view: "to_receive_mine",
      rows: itemRows(teamWaitingMine),
      rowsTitle: "Rigs sent to me, not received yet",
      whenLabel: "Sent at",
    },
    {
      label: "Rigs with me",
      value: numberText(withMeItems.length),
      view: "with_me",
      rows: itemRows(withMeItems),
      rowsTitle: "Rigs currently with me",
      whenLabel: "Since",
    },
    {
      label: "Hardware updates logged",
      value: numberText(myHardware.length),
      view: "hw_updates",
      rows: hardwareRows(myHardware),
      rowsTitle: "Hardware updates I logged",
      whenLabel: "Recorded at",
    },
    {
      label: "Repaired and sent to IM",
      value: numberText(sentToIm),
      view: "sent_im",
      rows: sentRows(sentToImEvents),
      rowsTitle: "Rigs I repaired and sent to an IM",
      whenLabel: "Sent at",
    },
  ];

  const handlerMetrics: Metric[] = [
    {
      label: "My recorded events",
      value: numberText(myEvents.length),
    },
    {
      label: "Sent events",
      value: numberText(sentCount),
    },
    {
      label: "Received events",
      value: numberText(receivedCount),
    },
    {
      label: "Acknowledged",
      value: sentItemsTotal ? `${numberText(sentItemsAcked)} of ${numberText(sentItemsTotal)}` : "—",
    },
    ...(sentItemsFlagged > 0
      ? [
          {
            label: "Flagged as a problem",
            value: numberText(sentItemsFlagged),
          },
        ]
      : []),
    {
      label: "Correction events",
      value: numberText(correctionCount),
    },
    {
      label: "Items currently with me",
      value: numberText(withMeItems.length),
      view: "with_me",
      rows: itemRows(withMeItems),
      rowsTitle: "Items currently with me",
      whenLabel: "Since",
    },
  ];

  const metrics = isQc ? qcMetrics : isHardware ? hardwareMetrics : handlerMetrics;
  const withMeTitle = isQc || isHardware ? "Rigs currently with me" : "Items currently with me";

  // The card the breakdown is open on, from ?view=.
  const requestedView = one(sp.view);
  const openMetric = metrics.find((m) => m.view && m.view === requestedView);
  const openRows = openMetric?.rows ?? [];
  const showQcColumn = isQc || isHardware;

  // Keeps the breakdown open while paging through the activity list below.
  const pageHref = (n: number) =>
    openMetric?.view ? `/dashboard/my?view=${openMetric.view}&page=${n}` : `/dashboard/my?page=${n}`;

  return (
    <div className={styles.root}>
      <main className={styles.wrap}>
        <p className={styles.back}>
          <Link href="/">← Home</Link>
        </p>

        <div className={styles.top}>
          <div>
            <h1>My dashboard</h1>

            <p className={styles.subtitle}>
              {linkedPerson?.name
                ? `${linkedPerson.name} · `
                : ""}
              {user.email} · {ROLE_LABELS[user.role]}
            </p>
          </div>

          <div className={styles.actions}>
            <Link
              href="/dashboard/my"
              className={styles.btn}
            >
              Refresh
            </Link>

            <Link
              href="/dashboard"
              className={styles.btn}
            >
              Inventory Dashboard
            </Link>

            <Link
              href="/handover/send"
              className={styles.btn}
            >
              Send items
            </Link>

            {canReceive && (
              <Link
                href="/handover/receive"
                className={styles.btn}
              >
                Receive items
              </Link>
            )}

            {(isQc || isHardware) && (
              <Link href="/rigs" className={styles.btn}>
                Rig checks
              </Link>
            )}

            {(isQc || isHardware) && (
              <Link href="/rigs/audit" className={styles.btn}>
                Audit trail
              </Link>
            )}
          </div>
        </div>

        {!isQc && !isHardware && (
          <p className={styles.muted}>
            All available history recorded by your login. Counts
            represent item-event records, not unique cards or
            handover batches. Current holdings are shown separately.
          </p>
        )}

        {/* Personal summary cards. A card with a breakdown opens it below when clicked. */}
        <section
          aria-label="My activity summary"
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
            gap: 16,
            marginBottom: 24,
          }}
        >
          {metrics.map((metric) => {
            const open = Boolean(metric.view) && metric.view === openMetric?.view;

            const body = (
              <>
                <span className={styles.summaryLabel}>
                  {metric.label}
                </span>

                <span className={styles.summaryValue}>
                  {metric.value}
                </span>

                {metric.view && (
                  <span className={styles.summaryNote}>
                    {open ? "Hide details" : "Show details"}
                  </span>
                )}
              </>
            );

            // Cards without a breakdown stay plain text, so nothing looks clickable for no reason.
            if (!metric.view) {
              return (
                <div key={metric.label} className={styles.summary}>
                  {body}
                </div>
              );
            }

            return (
              <Link
                key={metric.label}
                href={open ? "/dashboard/my" : `/dashboard/my?view=${metric.view}`}
                className={styles.summary}
                aria-current={open ? "true" : undefined}
                scroll={false}
                style={
                  open
                    ? { borderColor: "var(--text-primary)", boxShadow: "0 4px 14px rgba(11, 11, 11, 0.1)" }
                    : undefined
                }
              >
                {body}
              </Link>
            );
          })}
        </section>

        {/* The rigs behind the card that was clicked: IC number first, then the details. */}
        {openMetric && (
          <section className={styles.card} aria-label={openMetric.rowsTitle ?? openMetric.label} style={{ marginBottom: 24 }}>
            <div className={styles.top}>
              <h2>{openMetric.rowsTitle ?? openMetric.label}</h2>

              <div className={styles.actions}>
                <Link href="/dashboard/my" className={styles.btn}>
                  Close
                </Link>
              </div>
            </div>

            {openRows.length === 0 ? (
              <p className={styles.muted}>Nothing to show here right now.</p>
            ) : (
              <div
                className={styles.tableScroll}
                role="region"
                aria-label={openMetric.rowsTitle ?? openMetric.label}
                tabIndex={0}
                style={{ maxHeight: "500px", overflow: "auto" }}
              >
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">IC number</th>
                      <th scope="col">Prism no.</th>
                      <th scope="col">Brand</th>
                      <th scope="col">Model</th>
                      <th scope="col">Status</th>
                      {showQcColumn && <th scope="col">QC</th>}
                      <th scope="col">Where</th>
                      <th scope="col">{openMetric.whenLabel ?? "When"} (IST)</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>

                  <tbody>
                    {openRows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <Link href={`/inventory/${encodeURIComponent(row.itemId)}`}>{row.itemId}</Link>
                        </td>

                        <td>{row.prism || "—"}</td>
                        <td>{row.brand || "—"}</td>
                        <td>{row.model || "—"}</td>
                        <td>{row.status}</td>

                        {showQcColumn && (
                          <td style={{ fontWeight: 600, color: QC_COLOR[row.qc] }}>
                            {QC_LABELS[row.qc] ?? row.qc}
                          </td>
                        )}

                        <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{row.where || "—"}</td>
                        <td>{displayTime(row.when)}</td>
                        <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{row.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>

                  <tfoot>
                    <tr>
                      <th scope="row">Total</th>
                      <td colSpan={showQcColumn ? 8 : 7}>
                        <strong>{numberText(openRows.length)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Items assigned to the person linked to this login. */}
        <section
          className={styles.card}
          aria-label={withMeTitle}
        >
          <h2>{withMeTitle}</h2>

          {/* The items still with me; the box above shows the same count. */}
          {(
            <div
              className={styles.tableScroll}
              role="region"
              aria-label="My assigned items"
              tabIndex={0}
              style={{
                maxHeight: "400px",
                overflow: "auto",
              }}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Serial</th>
                    <th scope="col">Brand</th>
                    <th scope="col">Model</th>
                    <th scope="col">Status</th>
                    {(isQc || isHardware) && <th scope="col">QC</th>}
                    <th scope="col">Current hub</th>
                  </tr>
                </thead>

                <tbody>
                  {withMeItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={isQc || isHardware ? 6 : 5}
                        className={styles.muted}
                      >
                        No items are currently with you.
                      </td>
                    </tr>
                  ) : (
                    withMeItems.map((item) => (
                      <tr key={item.item_id}>
                        <td>
                          <Link
                            href={`/inventory/${item.item_id}`}
                          >
                            {item.item_id}
                          </Link>
                        </td>

                        <td>{item.brand || "—"}</td>
                        <td>{item.model || "—"}</td>

                        <td>
                          {STATUS_LABELS[item.status] ??
                            item.status}
                        </td>

                        {(isQc || isHardware) && (
                          <td
                            style={{
                              fontWeight: 600,
                              color: QC_COLOR[latestQc.get(item.item_id) || "qc_pending"],
                            }}
                          >
                            {QC_LABELS[latestQc.get(item.item_id) || "qc_pending"]}
                          </td>
                        )}

                        <td>
                          {hubNames.get(item.current_hub) ??
                            (item.current_hub || "—")}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>

                {/* Total appears after the full list. */}
                <tfoot>
                  <tr>
                    <th scope="row">Grand total</th>
                    <td colSpan={isQc || isHardware ? 5 : 4}>
                      <strong>
                        {numberText(withMeItems.length)}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* QC team: every QC result this login recorded. */}
        {isQc && (
          <section className={styles.card} aria-label="My QC results" style={{ marginTop: 24 }}>
            <h2>My QC results</h2>
            {myQc.length === 0 ? (
              <p className={styles.muted}>No QC results recorded yet. Open a rig from Rig checks to record Pass or Fail.</p>
            ) : (
              <div className={styles.tableScroll} role="region" aria-label="My QC results" tabIndex={0} style={{ maxHeight: "400px", overflow: "auto" }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Recorded at (IST)</th>
                      <th scope="col">Rig</th>
                      <th scope="col">Result</th>
                      <th scope="col">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myQc.map((c) => (
                      <tr key={c.check_id}>
                        <td>{displayTime(c.recorded_at)}</td>
                        <td>
                          <Link href={`/inventory/${encodeURIComponent(c.item_id)}`}>{c.item_id}</Link>
                        </td>
                        <td style={{ fontWeight: 600, color: QC_COLOR[c.qc_status] }}>{QC_LABELS[c.qc_status] ?? c.qc_status}</td>
                        <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{c.comment || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Hardware team: every repair update this login recorded. */}
        {isHardware && (
          <section className={styles.card} aria-label="My hardware updates" style={{ marginTop: 24 }}>
            <h2>My hardware updates</h2>
            {myHardware.length === 0 ? (
              <p className={styles.muted}>No hardware updates recorded yet. Open a rig from Rig checks to add one.</p>
            ) : (
              <div className={styles.tableScroll} role="region" aria-label="My hardware updates" tabIndex={0} style={{ maxHeight: "400px", overflow: "auto" }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Recorded at (IST)</th>
                      <th scope="col">Rig</th>
                      <th scope="col">Update</th>
                      <th scope="col">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myHardware.map((h) => (
                      <tr key={h.update_id}>
                        <td>{displayTime(h.recorded_at)}</td>
                        <td>
                          <Link href={`/inventory/${encodeURIComponent(h.item_id)}`}>{h.item_id}</Link>
                        </td>
                        <td>{h.update_type || "—"}</td>
                        <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{h.comment || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* History recorded by the authenticated login email. */}
        <section
          className={styles.card}
          aria-label="My recorded activity"
          style={{ marginTop: 24 }}
        >
          <h2>My recorded activity</h2>

          {myEvents.length === 0 ? (
            <p className={styles.muted}>
              No events have recorded_by matching your login email.
              A handover involving you may have been recorded by
              another user. Older records without your email in
              recorded_by will not appear here.
            </p>
          ) : (
            <>
              <p className={styles.muted}>
                Showing{" "}
                {numberText((page - 1) * PAGE_SIZE + 1)}–
                {numberText(
                  (page - 1) * PAGE_SIZE + shownEvents.length
                )}{" "}
                of {numberText(myEvents.length)} events.
                Times are IST.
              </p>

              <div
                className={styles.tableScroll}
                role="region"
                aria-label="My activity history"
                tabIndex={0}
                style={{
                  maxHeight: "500px",
                  overflow: "auto",
                }}
              >
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Recorded at (IST)</th>
                      <th scope="col">Occurred at (IST)</th>
                      <th scope="col">Action</th>
                      <th scope="col">Serial</th>
                      <th scope="col">From</th>
                      <th scope="col">To</th>
                      <th scope="col">Hub</th>
                      <th scope="col">Status after</th>
                      <th scope="col">Batch ID</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>

                  <tbody>
                    {shownEvents.map((event) => (
                      <tr key={event.event_id}>
                        <td>
                          {displayTime(event.recorded_at)}
                        </td>

                        <td>
                          {displayTime(event.occurred_at)}
                        </td>

                        <td>
                          {ACTION_LABELS[event.action] ??
                            event.action}
                        </td>

                        <td>
                          <Link
                            href={`/inventory/${event.item_id}`}
                          >
                            {event.item_id}
                          </Link>
                        </td>

                        <td
                          style={{
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {event.from_person || "—"}
                        </td>

                        <td
                          style={{
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {event.to_person || "—"}
                        </td>

                        <td>
                          {hubNames.get(event.hub) ??
                            (event.hub || "—")}
                        </td>

                        <td>
                          {STATUS_LABELS[event.status_after] ??
                            event.status_after}
                        </td>

                        <td>{event.batch_id || "—"}</td>

                        <td
                          style={{
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {event.note || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                className={styles.actions}
                style={{
                  marginTop: 16,
                  flexWrap: "wrap",
                }}
              >
                {page > 1 && (
                  <Link
                    href={pageHref(page - 1)}
                    className={styles.btn}
                  >
                    ← Previous
                  </Link>
                )}

                <span className={styles.muted}>
                  Page {page} of {totalPages}
                </span>

                {page < totalPages && (
                  <Link
                    href={pageHref(page + 1)}
                    className={styles.btn}
                  >
                    Next →
                  </Link>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

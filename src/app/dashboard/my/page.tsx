import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { QC_LABELS, ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import { OUT_STATUSES, type HardwareUpdate, type QcCheck, type Status } from "@/lib/schema";
import { MY_DASHBOARD_ROLES, RECEIVE_ROLES, storeFor } from "@/lib/access";
import { formatIst } from "@/lib/time";
import styles from "../dashboard.module.css";

// Statuses in which an item is in someone's hands (QC and hardware hold rigs too).
const HELD_STATUSES: readonly Status[] = [...OUT_STATUSES, "with_qc", "with_hardware"];

const QC_COLOR: Record<string, string> = { pass: "#15803D", fail: "#B42318", qc_pending: "#8A4B00" };

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

  const [events, items, people, hubs, users, qcChecks, hardwareUpdates] = await Promise.all([
    store.list("events"),
    store.list("items"),
    store.list("people"),
    store.list("hubs"),
    store.list("users"),
    isQc || isHardware ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
    isHardware ? store.list("hardware_updates") : Promise.resolve([] as HardwareUpdate[]),
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

  const linkedPersonId =
    candidatePersonIds.size === 1
      ? Array.from(candidatePersonIds)[0]
      : undefined;

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
  const sentToIm = myEvents.filter((e) => e.action === "check_out" && e.status_after === "pending").length;
  const sentToHardware = myEvents.filter((e) => e.action === "check_out" && e.status_after === "with_hardware").length;

  // A rig with me is waiting for QC when no result was recorded since it reached me.
  const waitingForQc = (item: (typeof items)[number]) => {
    const arrived = Date.parse(eventById.get(item.last_event_id)?.occurred_at ?? item.updated_at ?? "");
    const checked = latestQcAt.get(item.item_id);
    return checked === undefined || (Number.isFinite(arrived) && checked < arrived);
  };

  // Rigs sent to me that I have not received yet (Receive items).
  const toReceive = linkedPerson
    ? items.filter(
        (i) =>
          i.current_holder === linkedPerson.person_id &&
          i.status === (isQc ? "pending_qc" : "pending_hardware")
      ).length
    : 0;

  const qcMetrics = [
    { label: "Waiting for me to receive", value: numberText(toReceive) },
    { label: "Rigs with me", value: numberText(withMeItems.length) },
    { label: "Waiting for my QC result", value: numberText(withMeItems.filter(waitingForQc).length) },
    { label: "QC pass recorded", value: numberText(myQc.filter((c) => c.qc_status === "pass").length) },
    { label: "QC fail recorded", value: numberText(myQc.filter((c) => c.qc_status === "fail").length) },
    { label: "Sent to IM", value: numberText(sentToIm) },
    { label: "Sent to hardware team", value: numberText(sentToHardware) },
  ];

  const hardwareMetrics = [
    { label: "Waiting for me to receive", value: numberText(toReceive) },
    { label: "Rigs with me", value: numberText(withMeItems.length) },
    { label: "Hardware updates logged", value: numberText(myHardware.length) },
    { label: "Repaired and sent to IM", value: numberText(sentToIm) },
  ];

  const handlerMetrics = [
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
      label: "Correction events",
      value: numberText(correctionCount),
    },
    {
      label: "Items currently with me",
      value: numberText(withMeItems.length),
    },
  ];

  const metrics = isQc ? qcMetrics : isHardware ? hardwareMetrics : handlerMetrics;
  const withMeTitle = isQc || isHardware ? "Rigs currently with me" : "Items currently with me";

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
          </div>
        </div>

        {!isQc && !isHardware && (
          <p className={styles.muted}>
            All available history recorded by your login. Counts
            represent item-event records, not unique cards or
            handover batches. Current holdings are shown separately.
          </p>
        )}

        {/* Personal summary cards. */}
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
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className={styles.summary}
            >
              <span className={styles.summaryLabel}>
                {metric.label}
              </span>

              <span className={styles.summaryValue}>
                {metric.value}
              </span>
            </div>
          ))}
        </section>

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
                    href={`/dashboard/my?page=${page - 1}`}
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
                    href={`/dashboard/my?page=${page + 1}`}
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
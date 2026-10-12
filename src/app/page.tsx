import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import { OUT_STATUSES } from "@/lib/schema";
import { getStore } from "@/lib/store";
import { formatIst } from "@/lib/time";
import styles from "../dashboard.module.css";

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
  const user = await requireRole("admin", "im", "rig");
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
  const store = getStore();

  const [events, items, people, hubs, users] = await Promise.all([
    store.list("events"),
    store.list("items"),
    store.list("people"),
    store.list("hubs"),
    store.list("users"),
  ]);

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
          OUT_STATUSES.includes(item.status)
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

  // Items currently with me = received − sent (never below zero).
  const withMeCount = Math.max(0, receivedCount - sentCount);

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

  const metrics = [
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
      value: numberText(withMeCount),
    },
  ];

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

            <Link
              href="/handover/receive"
              className={styles.btn}
            >
              Receive items
            </Link>
          </div>
        </div>

        <p className={styles.muted}>
          All available history recorded by your login. Counts
          represent item-event records, not unique cards or
          handover batches. Current holdings are shown separately.
        </p>

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
          aria-label="Items currently with me"
        >
          <h2>Items currently with me</h2>

          {/* Received − sent; the cards below are the ones not sent on yet. */}
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
                    <th scope="col">Current hub</th>
                  </tr>
                </thead>

                <tbody>
                  {withMeItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
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
                    <td colSpan={4}>
                      <strong>
                        {numberText(withMeCount)}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

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
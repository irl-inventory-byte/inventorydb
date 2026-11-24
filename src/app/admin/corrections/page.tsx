import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { STATUS_LABELS } from "@/lib/labels";
import type { Status } from "@/lib/schema";
import { formatIst } from "@/lib/time";
import styles from "../admin.module.css";
import BackLink from "../../BackLink";

/**
 * Admin-only log of Correction entries: every time an item's status/hub/holder was set directly via
 * a Correction (the Inventory item page's "Correct status / location" panel, the Lost page's scan
 * report, etc. all record this as one "correct" event per item). Shows what changed, when, and who
 * did it — for auditing corrections after the fact.
 */
export default async function CorrectionsPage() {
  await requireRole("admin");

  const store = getStore();
  const [events, hubs, people, users] = await Promise.all([
    store.list("events"),
    store.list("hubs"),
    store.list("people"),
    store.list("users"),
  ]);

  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));
  // A correction's `recorded_by` is always the login's email. Resolve it to a real name via the
  // Users tab (email → person_id) and People (person_id → name); an unlinked login just shows its
  // email, same as everywhere else in the app that shows "recorded by".
  const nameByEmail = new Map(
    users
      .filter((u) => u.person_id)
      .map((u) => [u.email.toLowerCase(), personName.get(u.person_id) ?? u.email]),
  );
  const byName = (email: string) => nameByEmail.get((email || "").toLowerCase()) || email || "—";

  // Newest first.
  const rows = events
    .filter((e) => e.action === "correct")
    .sort((a, b) => Date.parse(b.occurred_at || "0") - Date.parse(a.occurred_at || "0"));

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <BackLink />
      </p>

      <h1>Correction entries</h1>

      <p className={styles.muted}>
        Every time an item&apos;s status, hub or holder was set directly via a Correction, with who did
        it and when. {rows.length} correction{rows.length === 1 ? "" : "s"}.
      </p>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Date &amp; time</th>
              <th scope="col">Item</th>
              <th scope="col">Set to</th>
              <th scope="col">Hub</th>
              <th scope="col">Holder</th>
              <th scope="col">Note</th>
              <th scope="col">Corrected by</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className={styles.muted}>
                  No corrections have been recorded yet.
                </td>
              </tr>
            ) : (
              rows.map((e) => (
                <tr key={e.event_id}>
                  <td style={{ whiteSpace: "nowrap" }}>{formatIst(e.occurred_at)} IST</td>
                  <td style={{ overflowWrap: "anywhere" }}>{e.item_id}</td>
                  <td>{(STATUS_LABELS[e.status_after as Status] ?? e.status_after) || "—"}</td>
                  <td>{hubName.get(e.hub) ?? (e.hub || "—")}</td>
                  <td>{personName.get(e.to_person) ?? (e.to_person || e.from_person || "—")}</td>
                  <td style={{ minWidth: 200 }}>{e.note || "—"}</td>
                  <td>
                    {byName(e.recorded_by)}
                    <div className={styles.muted}>{e.recorded_by}</div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
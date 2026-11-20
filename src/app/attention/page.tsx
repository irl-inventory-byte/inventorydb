import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { LATE_AFTER_HOURS } from "@/lib/dashboard";
import type { DelayNote } from "@/lib/schema";
import { storeForAll } from "@/lib/access";
import { getStore } from "@/lib/store";
import { buildAttentionReport, howLong } from "@/lib/attention";
import styles from "../dashboard/dashboard.module.css";
import { Icon } from "../dashboard/icons";

export default async function AttentionPage() {
  // Same roles as the "Need attention" tile on the home page — Admin and IM only.
  const user = await requireRole("admin", "im");

  // All item types this login can see at once — the same storeForAll(role) pattern dashboard/page.tsx
  // uses for its Monthly report, so a rig-only login (QC, hardware) still only sees rigs, while an IM
  // or admin sees every type together.
  const store = storeForAll(user.role);
  const [items, events, people, hubs] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("people"),
    store.list("hubs"),
  ]);
  // Delay notes aren't shown on this page yet, but fetched to keep the shape ready for later; harmless
  // if the tab doesn't exist.
  await getStore().list("delay_notes").catch(() => [] as DelayNote[]);

  const now = new Date();
  const { shownDelayed, byType } = buildAttentionReport(items, events, people, hubs, now);
  const total = [...byType.values()].reduce((sum, n) => sum + n, 0);

  return (
    <div className={styles.root}>
      <main className={styles.wrap}>
        <div className={styles.top}>
          <div className={styles.brand}>
            <span className={styles.brandIconPlain}>
              <Icon name="alert" size={26} />
            </span>
            <div>
              <h1>Need attention</h1>
              <p className={styles.subtitle}>
                Every Rig, SD card, Mobile and Power bank this login can see that has been with its holder, or
                sent to a hub and not received, for more than {LATE_AFTER_HOURS} hours.
              </p>
            </div>
          </div>
          <div className={styles.actions}>
            <a className={`${styles.btn} ${styles.btnReset}`} href="/api/attention/pdf" target="_blank" rel="noopener noreferrer">
              <Icon name="database" size={16} /> Download PDF
            </a>
            <Link className={`${styles.btn} ${styles.btnReset}`} href="/">
              Back to home
            </Link>
          </div>
        </div>

        <section className={styles.card} aria-label="Summary">
          <h2>Summary</h2>
          {total === 0 ? (
            <p className={styles.ok}>
              <span className={`${styles.icon} ${styles.iconGood}`} aria-hidden>
                ✓
              </span>{" "}
              Nothing needs attention right now.
            </p>
          ) : (
            <p className={styles.muted}>
              {total} item{total === 1 ? "" : "s"} need attention —{" "}
              {[...byType.entries()].map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`).join(", ")}.
            </p>
          )}
        </section>

        {shownDelayed.length > 0 && (
          <section className={styles.card} id="attention" aria-label="Needs attention" style={{ minWidth: 0 }}>
            <h2>Needs attention</h2>
            <p className={styles.muted}>
              Each item an FO, IFO, rig team, internal or hardware-team person has held, or that was sent to a
              hub and not received, for more than {LATE_AFTER_HOURS} hours since its last send or receive.
              Cards with the same type, person, sender and send date are one row; Count = how many. Oldest first.
            </p>

            <div
              className={styles.tableScroll}
              role="region"
              aria-label="Delayed items — scrollable table"
              tabIndex={0}
              style={{ maxHeight: "640px", maxWidth: "100%", overflowY: "auto", overflowX: "auto" }}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Person</th>
                    <th>Role</th>
                    <th>City</th>
                    <th>Sent by</th>
                    <th>Sent on</th>
                    <th>Issue</th>
                    <th>Out for</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {shownDelayed.map((g) => (
                    <tr key={g.key}>
                      <td>{g.type}</td>
                      <td>
                        <Link href={g.href}>{g.person}</Link>
                      </td>
                      <td>{g.role}</td>
                      <td>{g.city}</td>
                      <td>{g.sentBy}</td>
                      <td>{g.sentOn}</td>
                      <td>{g.issue}</td>
                      <td>{howLong(g.hours)}</td>
                      <td>
                        <Link href={g.href}>{g.count}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
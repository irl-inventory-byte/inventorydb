import Link from "next/link";
import type { CSSProperties } from "react";
import { requireRole } from "@/lib/authz";
import { LATE_AFTER_HOURS } from "@/lib/dashboard";
import type { DelayNote } from "@/lib/schema";
import { storeForAll } from "@/lib/access";
import { getStore } from "@/lib/store";
import { buildAttentionReport, filterDelayed, filterOptions, howLong, type AttentionFilters } from "@/lib/attention";
import { one } from "@/lib/labels";
import styles from "../dashboard/dashboard.module.css";
import { Icon } from "../dashboard/icons";

// Quick filters for "out for at least this long". 0 = everything (the original LATE_AFTER_HOURS
// cutoff); the others let you narrow straight to "2+ days" etc. without scrolling the table.
const DAY_OPTIONS = [
  { value: "0", label: `All (${LATE_AFTER_HOURS}+ hrs)` },
  { value: "1", label: "1+ day" },
  { value: "2", label: "2+ days" },
  { value: "3", label: "3+ days" },
  { value: "7", label: "7+ days" },
];

export default async function AttentionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Same roles as the "Need attention" tile on the home page — Admin and IM only.
  const user = await requireRole("admin", "im");

  const sp = await searchParams;
  const minDaysRaw = Number(one(sp.days) || "0");
  const minDays = Number.isFinite(minDaysRaw) && minDaysRaw > 0 ? minDaysRaw : 0;
  const typeFilter = one(sp.type);
  const roleFilter = one(sp.role);
  const cityFilter = one(sp.city);
  const filters: AttentionFilters = { minDays, type: typeFilter, role: roleFilter, city: cityFilter };

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
  const { shownDelayed: allDelayed, byType: byTypeAll } = buildAttentionReport(items, events, people, hubs, now);

  // Dropdown options come from the FULL list (before filtering), so picking one filter doesn't hide
  // the others you could still switch to.
  const options = filterOptions(allDelayed);

  const shownDelayed = filterDelayed(allDelayed, filters);
  const byType = new Map<string, number>();
  for (const g of shownDelayed) byType.set(g.type, (byType.get(g.type) ?? 0) + g.count);
  const total = [...byType.values()].reduce((sum, n) => sum + n, 0);
  const totalAll = [...byTypeAll.values()].reduce((sum, n) => sum + n, 0);
  const anyFilter = minDays > 0 || !!typeFilter || !!roleFilter || !!cityFilter;

  // Carries the current filters onto another link/the PDF download, same pattern as the Lost items
  // page's `keep()`.
  const withFilters = (extra: Record<string, string> = {}) =>
    new URLSearchParams({
      ...(minDays > 0 && { days: String(minDays) }),
      ...(typeFilter && { type: typeFilter }),
      ...(roleFilter && { role: roleFilter }),
      ...(cityFilter && { city: cityFilter }),
      ...extra,
    }).toString();

  const chip = (on: boolean): CSSProperties => ({
    padding: "6px 14px",
    borderRadius: 999,
    border: "1px solid #cbd5e1",
    background: on ? "#1e293b" : "#ffffff",
    color: on ? "#ffffff" : "#334155",
    textDecoration: "none",
    fontWeight: on ? 700 : 500,
    fontSize: "0.9rem",
  });

  const selectStyle: CSSProperties = { padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.9rem" };

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
            <a
              className={`${styles.btn} ${styles.btnReset}`}
              href={`/attention/pdf${withFilters() ? `?${withFilters()}` : ""}`}
              download
            >
              <Icon name="database" size={16} /> Download PDF
            </a>
            <Link className={`${styles.btn} ${styles.btnReset}`} href="/">
              Back to home
            </Link>
          </div>
        </div>

        <section className={styles.card} aria-label="Summary">
          <h2>Summary</h2>
          {totalAll === 0 ? (
            <p className={styles.ok}>
              <span className={`${styles.icon} ${styles.iconGood}`} aria-hidden>
                ✓
              </span>{" "}
              Nothing needs attention right now.
            </p>
          ) : total === 0 ? (
            <p className={styles.ok}>
              <span className={`${styles.icon} ${styles.iconGood}`} aria-hidden>
                ✓
              </span>{" "}
              Nothing matches this filter right now ({totalAll} item{totalAll === 1 ? "" : "s"} need attention overall).
            </p>
          ) : (
            <p className={styles.muted}>
              {total} item{total === 1 ? "" : "s"}
              {anyFilter ? " match this filter" : " need attention"} —{" "}
              {[...byType.entries()].map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`).join(", ")}.
            </p>
          )}
        </section>

        <nav aria-label="Filter by how long out" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "4px 0 8px" }}>
          {DAY_OPTIONS.map((o) => (
            <Link
              key={o.value}
              href={`/attention?${withFilters({ days: o.value === "0" ? "" : o.value })}`}
              aria-current={o.value === String(minDays) ? "true" : undefined}
              style={chip(o.value === String(minDays))}
            >
              {o.label}
            </Link>
          ))}
        </nav>

        <form
          action="/attention"
          method="get"
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, margin: "0 0 16px" }}
        >
          {minDays > 0 && <input type="hidden" name="days" value={minDays} />}
          <select name="type" defaultValue={typeFilter} style={selectStyle} aria-label="Filter by item type">
            <option value="">All item types</option>
            {options.types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select name="role" defaultValue={roleFilter} style={selectStyle} aria-label="Filter by role">
            <option value="">All roles</option>
            {options.roles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select name="city" defaultValue={cityFilter} style={selectStyle} aria-label="Filter by city">
            <option value="">All cities</option>
            {options.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button
            type="submit"
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #222", background: "var(--btn-bg)", color: "var(--btn-text)", fontWeight: 600, cursor: "pointer" }}
          >
            Apply
          </button>
          {(typeFilter || roleFilter || cityFilter) && (
            <Link href={`/attention${minDays > 0 ? `?days=${minDays}` : ""}`} style={{ fontSize: "0.85rem" }}>
              Clear type/role/city
            </Link>
          )}
        </form>

        {shownDelayed.length > 0 && (
          <section className={styles.card} id="attention" aria-label="Needs attention" style={{ minWidth: 0 }}>
            <h2>Needs attention</h2>
            <p className={styles.muted}>
              Each item an FO, IFO, rig team, internal or hardware-team person has held, or that was sent to a
              hub and not received, for more than {minDays > 0 ? `${minDays * 24}` : LATE_AFTER_HOURS} hours since its last
              send or receive. Cards with the same type, person, sender and send date are one row; Count = how
              many. Oldest first.
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
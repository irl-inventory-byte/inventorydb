import Link from "next/link";
import type { CSSProperties } from "react";
import { storeForAll, VIEW_ROLES } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { STATUS_LABELS, one } from "@/lib/labels";
import { unusedByCity, unusedByHub, unusedItems } from "@/lib/item-audit";
import { formatIst } from "@/lib/time";
import styles from "../admin/admin.module.css";

const TYPE_NAME: Record<string, string> = { sd_card: "SD card", rig: "Rig", mobile: "Mobile" };
const MIN_DAYS = 1;

/**
 * CITY / HUB AUDIT: every item (SD card, rig or mobile) with no status change (handover) for
 * MIN_DAYS+ days, grouped by city and hub. Read-only — no reports, unlike Rig Audit.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(...VIEW_ROLES);
  const sp = await searchParams;
  const q = one(sp.q).trim().toLowerCase();
  const city = one(sp.city);
  const hubFilter = one(sp.hub);

  const store = storeForAll(user.role);
  const [items, events, hubs] = await Promise.all([store.list("items"), store.list("events"), store.list("hubs")]);
  const now = new Date();
  const unused = unusedItems(items, events, hubs, now, MIN_DAYS);

  const byCity = unusedByCity(unused);
  const byHub = unusedByHub(unused, hubs, city);

  const shown = unused.filter((u) => {
    if (city && u.city !== city) return false;
    if (hubFilter && u.hub !== hubFilter) return false;
    if (!q) return true;
    return [u.item_id, u.hub, u.city].some((v) => (v ?? "").toLowerCase().includes(q));
  });

  const keep = (extra: Record<string, string>) =>
    `/audit?${new URLSearchParams({ ...(q && { q }), ...(city && { city }), ...(hubFilter && { hub: hubFilter }), ...extra })}`;

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link> · <Link href="/dashboard">Dashboard</Link>
      </p>
      <h1>City / Hub Audit ({unused.length})</h1>
      <p className={styles.muted}>
        Every SD card, rig and mobile with no status change for {MIN_DAYS}+ day{MIN_DAYS === 1 ? "" : "s"}, by city and
        hub. &quot;No activity&quot; = no handover recorded since the item&apos;s last status change (or since it was
        added, if it has never moved).
      </p>

      {(() => {
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
        return (
          <>
            <nav aria-label="Audit by city" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "4px 0 8px" }}>
              <Link href={`/audit?${new URLSearchParams({ ...(q && { q }) })}`} aria-current={!city ? "true" : undefined} style={chip(!city)}>
                All cities · {unused.length}
              </Link>
              {byCity.map(({ city: c, count }) => (
                <Link
                  key={c}
                  href={`/audit?${new URLSearchParams({ city: c, ...(q && { q }) })}`}
                  aria-current={c === city ? "true" : undefined}
                  style={chip(c === city)}
                >
                  {c} · {count}
                </Link>
              ))}
            </nav>

            {city && byHub.length > 0 && (
              <nav aria-label="Audit by hub" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "4px 0 16px" }}>
                <Link href={keep({ hub: "" })} aria-current={!hubFilter ? "true" : undefined} style={chip(!hubFilter)}>
                  All hubs in {city} · {byHub.reduce((t, h) => t + h.count, 0)}
                </Link>
                {byHub.map((h) => (
                  <Link key={h.hub} href={keep({ hub: h.hub })} aria-current={h.hub === hubFilter ? "true" : undefined} style={chip(h.hub === hubFilter)}>
                    {h.hubName} · {h.count}
                  </Link>
                ))}
              </nav>
            )}
          </>
        );
      })()}

      <form className={styles.row} method="get">
        {city && <input type="hidden" name="city" value={city} />}
        {hubFilter && <input type="hidden" name="hub" value={hubFilter} />}
        <input name="q" defaultValue={one(sp.q)} placeholder="Search item ID, hub or city" aria-label="Search items to audit" />
        <button type="submit">Search</button>
        {(q || city || hubFilter) && <Link href="/audit">Clear</Link>}
      </form>

      {shown.length === 0 ? (
        <p className={styles.muted}>{unused.length ? "No items match." : "Every item has had activity in the last day."}</p>
      ) : (
        <div role="region" aria-label="City / hub audit" tabIndex={0} style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Status</th>
                <th>City</th>
                <th>Hub</th>
                <th>Last activity</th>
                <th>No activity for</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.item_id}>
                  <td>
                    <Link href={`/inventory/${encodeURIComponent(u.item_id)}`} style={{ fontWeight: 600 }}>
                      {u.item_id}
                    </Link>
                  </td>
                  <td>{TYPE_NAME[u.item_type] ?? u.item_type}</td>
                  <td>{STATUS_LABELS[u.status] ?? u.status}</td>
                  <td>{u.city}</td>
                  <td>{u.hub || "—"}</td>
                  <td>{u.lastActivity ? formatIst(u.lastActivity) : "—"}</td>
                  <td>{u.days} day{u.days === 1 ? "" : "s"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
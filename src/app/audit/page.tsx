import Link from "next/link";
import type { CSSProperties } from "react";
import { storeForAll, VIEW_ROLES } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { STATUS_LABELS, one } from "@/lib/labels";
import { lastAuditedAt, unusedByCity, unusedByHub, unusedItems } from "@/lib/item-audit";
import { formatIst } from "@/lib/time";
import styles from "../admin/admin.module.css";
import { markAudited } from "./actions";
import SelectAllCheckbox from "./Selectallcheckbox";

const TYPE_NAME: Record<string, string> = { sd_card: "SD card", rig: "Rig", mobile: "Mobile" };
const MIN_DAYS = 1;
const FORM_ID = "audit-select-form";

/**
 * CITY / HUB AUDIT: every in-stock item (SD card, rig or mobile) with no status change (handover)
 * for MIN_DAYS+ days, grouped by city and hub. Tick items that were physically checked and confirm
 * them — that's logged (who, when) and shows up in the item's History, without changing its status.
 */
export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  // VIEW_ROLES minus "internal" — Internal doesn't get City / Hub Audit (per request); kept in sync
  // with the tile's own roles list on the home page (src/app/page.tsx).
  const user = await requireRole(...VIEW_ROLES.filter((r) => r !== "internal"));
  const sp = await searchParams;
  const q = one(sp.q).trim().toLowerCase();
  const city = one(sp.city);
  const hubFilter = one(sp.hub);
  const typeFilter = one(sp.type); // "" (all), "sd_card", "rig" or "mobile"
  const dateFrom = one(sp.from); // "YYYY-MM-DD", filters by last-activity date
  const dateTo = one(sp.to); // "YYYY-MM-DD", filters by last-activity date
  const auditedMsg = one(sp.audited);
  const auditError = one(sp.error);

  const store = storeForAll(user.role);
  const [items, events, hubs, audits] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("hubs"),
    store.list("audits"),
  ]);
  const now = new Date();
  const unused = unusedItems(items, events, hubs, now, MIN_DAYS);
  const auditedAt = lastAuditedAt(audits);

  // The date filter applies first (it's the broadest), then item-type, then city/hub.
  const inDateRange = (u: { lastActivity: string }) => {
    if (!dateFrom && !dateTo) return true;
    const activityDate = u.lastActivity ? u.lastActivity.slice(0, 10) : "";
    if (!activityDate) return false;
    if (dateFrom && activityDate < dateFrom) return false;
    if (dateTo && activityDate > dateTo) return false;
    return true;
  };
  const dateScoped = unused.filter(inDateRange);

  // Item-type counts (for the filter chips), from the date-scoped list.
  const byType = Object.entries(TYPE_NAME)
    .map(([value, label]) => ({ value, label, count: dateScoped.filter((u) => u.item_type === value).length }))
    .filter((t) => t.count > 0);

  // City/hub breakdowns and the table reflect the date and item-type filters, so counts stay consistent with what's shown.
  const typeFiltered = typeFilter ? dateScoped.filter((u) => u.item_type === typeFilter) : dateScoped;
  const dateFiltered = typeFiltered;
  const byCity = unusedByCity(dateFiltered);
  const byHub = unusedByHub(dateFiltered, hubs, city);

  const shown = dateFiltered.filter((u) => {
    if (city && u.city !== city) return false;
    if (hubFilter && u.hub !== hubFilter) return false;
    if (!q) return true;
    return [u.item_id, u.hub, u.city].some((v) => (v ?? "").toLowerCase().includes(q));
  });

  const keep = (extra: Record<string, string>) =>
    `/audit?${new URLSearchParams({
      ...(q && { q }),
      ...(city && { city }),
      ...(hubFilter && { hub: hubFilter }),
      ...(typeFilter && { type: typeFilter }),
      ...(dateFrom && { from: dateFrom }),
      ...(dateTo && { to: dateTo }),
      ...extra,
    })}`;

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link> · <Link href="/dashboard">Dashboard</Link>
      </p>
      <h1>City / Hub Audit ({unused.length})</h1>
      <p className={styles.muted}>
        Every in-stock SD card, rig and mobile with no status change for {MIN_DAYS}+ day{MIN_DAYS === 1 ? "" : "s"}, by
        city and hub. &quot;No activity&quot; = no handover recorded since the item&apos;s last status change (or
        since it was added, if it has never moved). Use the date filter below to show only items whose last activity
        falls in a given range. Tick the items you&apos;ve physically checked and press &quot;Mark as audited&quot; —
        it&apos;s logged (who, when) in the item&apos;s History; status and no-activity count stay unchanged.
      </p>

      {auditedMsg && <p className={styles.ok}>Marked {auditedMsg} item(s) as audited.</p>}
      {auditError && <p className={styles.error}>{auditError}</p>}

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
            <nav aria-label="Audit by item type" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "4px 0 8px" }}>
              <Link
                href={`/audit?${new URLSearchParams({ ...(q && { q }), ...(city && { city }), ...(hubFilter && { hub: hubFilter }), ...(dateFrom && { from: dateFrom }), ...(dateTo && { to: dateTo }) })}`}
                aria-current={!typeFilter ? "true" : undefined}
                style={chip(!typeFilter)}
              >
                All items · {dateScoped.length}
              </Link>
              {byType.map((t) => (
                <Link
                  key={t.value}
                  href={`/audit?${new URLSearchParams({ type: t.value, ...(q && { q }), ...(city && { city }), ...(hubFilter && { hub: hubFilter }), ...(dateFrom && { from: dateFrom }), ...(dateTo && { to: dateTo }) })}`}
                  aria-current={t.value === typeFilter ? "true" : undefined}
                  style={chip(t.value === typeFilter)}
                >
                  {t.label} · {t.count}
                </Link>
              ))}
            </nav>

            <nav aria-label="Audit by city" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "4px 0 8px" }}>
              <Link
                href={`/audit?${new URLSearchParams({ ...(q && { q }), ...(typeFilter && { type: typeFilter }), ...(dateFrom && { from: dateFrom }), ...(dateTo && { to: dateTo }) })}`}
                aria-current={!city ? "true" : undefined}
                style={chip(!city)}
              >
                All cities · {typeFiltered.length}
              </Link>
              {byCity.map(({ city: c, count }) => (
                <Link
                  key={c}
                  href={`/audit?${new URLSearchParams({ city: c, ...(q && { q }), ...(typeFilter && { type: typeFilter }), ...(dateFrom && { from: dateFrom }), ...(dateTo && { to: dateTo }) })}`}
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
        {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
        <input name="q" defaultValue={one(sp.q)} placeholder="Search item ID, hub or city" aria-label="Search items to audit" />
        <button type="submit">Search</button>
        {(q || city || hubFilter || typeFilter || dateFrom || dateTo) && <Link href="/audit">Clear all</Link>}
      </form>

      <form
        className={styles.row}
        method="get"
        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0 16px" }}
      >
        {city && <input type="hidden" name="city" value={city} />}
        {hubFilter && <input type="hidden" name="hub" value={hubFilter} />}
        {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
        {q && <input type="hidden" name="q" value={one(sp.q)} />}
        <label style={{ fontSize: "0.85rem", color: "#334155" }}>
          Last activity from{" "}
          <input type="date" name="from" defaultValue={dateFrom} aria-label="Last activity from" />
        </label>
        <label style={{ fontSize: "0.85rem", color: "#334155" }}>
          to <input type="date" name="to" defaultValue={dateTo} aria-label="Last activity to" />
        </label>
        <button type="submit">Filter by date</button>
        {(dateFrom || dateTo) && <Link href={keep({ from: "", to: "" })}>Clear dates</Link>}
      </form>

      {shown.length === 0 ? (
        <p className={styles.muted}>{typeFiltered.length ? "No items match." : "Every in-stock item has had activity in the last day."}</p>
      ) : (
        <form id={FORM_ID} action={markAudited}>
          <input type="hidden" name="back" value={keep({})} />
          <div role="region" aria-label="City / hub audit" tabIndex={0} style={{ overflowX: "auto" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    <SelectAllCheckbox formId={FORM_ID} />
                  </th>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>City</th>
                  <th>Hub</th>
                  <th>Last activity</th>
                  <th>No activity for</th>
                  <th>Last audited</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => (
                  <tr key={u.item_id}>
                    <td>
                      <input type="checkbox" name="ids" value={u.item_id} aria-label={`Select ${u.item_id} to audit`} />
                    </td>
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
                    <td>{auditedAt.has(u.item_id) ? formatIst(auditedAt.get(u.item_id)!) : "Never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="submit">Mark selected as audited</button>
          </div>
        </form>
      )}
    </main>
  );
}
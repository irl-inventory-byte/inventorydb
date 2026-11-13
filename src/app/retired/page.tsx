import Link from "next/link";
import { storeForAll, VIEW_ROLES } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { lostList } from "@/lib/lost";
import { formatIst } from "@/lib/time";
import styles from "../admin/admin.module.css";
import ReportRetiredScan from "./ReportRetiredScan";

const TYPE_NAME: Record<string, string> = { sd_card: "SD card", rig: "Rig", mobile: "Mobile", power_bank: "Power Bank" };

/**
 * RETIRED ITEMS: the detail view behind the dashboard's "Retired" tile. Reuses the same "correct"
 * event / lostList() machinery as the Lost and Broken pages (see lib/lost.ts) — a retirement is just
 * a correction that sets status to "retired", so this page reads it the same way.
 */
export default async function RetiredItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(...VIEW_ROLES);
  const canRetire = user.role === "admin" || user.role === "im";
  const sp = await searchParams;
  const typeFilter = one(sp.type);
  const error = one(sp.error);
  const retired = Number(one(sp.retired) || "0");

  const store = storeForAll(user.role);
  const [items, events, hubs] = await Promise.all([store.list("items"), store.list("events"), store.list("hubs")]);

  const all = lostList(items, events, hubs, "retired");
  const byType = Object.entries(TYPE_NAME)
    .map(([value, label]) => ({ value, label, count: all.filter((r) => r.item_type === value).length }))
    .filter((t) => t.count > 0);
  const rows = typeFilter ? all.filter((r) => r.item_type === typeFilter) : all;

  const keep = (extra: Record<string, string>) => `/retired?${new URLSearchParams({ ...(typeFilter && { type: typeFilter }), ...extra })}`;

  const chip = (on: boolean) => ({
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
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/dashboard">Dashboard</Link>
      </p>
      <h1>Retired items ({all.length})</h1>
      <p className={styles.muted}>Taken out of service for good. Date and reason come from when the item was retired.</p>

      {error && (
        <p style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: "8px 12px" }}>{error}</p>
      )}

      {retired > 0 && (
        <p style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: 8, padding: "8px 12px" }}>
          Retired {retired} item{retired === 1 ? "" : "s"}.
        </p>
      )}

      {canRetire && <ReportRetiredScan items={items.map((i) => ({ id: i.item_id, status: i.status, type: i.item_type }))} />}

      <nav aria-label="Filter by item type" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "4px 0 16px" }}>
        <Link href={keep({ type: "" })} aria-current={!typeFilter ? "true" : undefined} style={chip(!typeFilter)}>
          All items · {all.length}
        </Link>
        {byType.map((t) => (
          <Link key={t.value} href={keep({ type: t.value })} aria-current={t.value === typeFilter ? "true" : undefined} style={chip(t.value === typeFilter)}>
            {t.label} · {t.count}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className={styles.muted}>No retired items right now.</p>
      ) : (
        <div role="region" aria-label="Retired items" tabIndex={0} style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date retired</th>
                <th>Item</th>
                <th>Type</th>
                <th>City</th>
                <th>Hub</th>
                <th>Retired by</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_id}>
                  <td>{r.date ? formatIst(r.date) : "—"}</td>
                  <td>
                    <Link href={`/inventory/${encodeURIComponent(r.item_id)}`} style={{ fontWeight: 600 }}>
                      {r.item_id}
                    </Link>
                  </td>
                  <td>{TYPE_NAME[r.item_type] ?? r.item_type}</td>
                  <td>{r.city}</td>
                  <td>{r.hub || "—"}</td>
                  <td>{r.recordedBy || "—"}</td>
                  <td>{r.initialNote || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
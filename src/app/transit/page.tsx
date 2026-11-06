import Link from "next/link";
import { storeForAll, VIEW_ROLES } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { formatIst } from "@/lib/time";
import styles from "../admin/admin.module.css";
import BackLink from "../BackLink";

const TYPE_NAME: Record<string, string> = { sd_card: "SD card", rig: "Rig", mobile: "Mobile" };

/**
 * IN TRANSIT: the detail view behind the dashboard's "In transit" tile (status traveling or pending).
 * Shows each item's route — From city/hub to To city/hub — taken from its most recent event
 * (from_hub = where it was, hub = where it's headed; see schema.ts). Filterable by item type and by
 * from/to city.
 */
export default async function TransitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(...VIEW_ROLES);
  const sp = await searchParams;
  const typeFilter = one(sp.type);
  const fromFilter = one(sp.from);
  const toFilter = one(sp.to);
  const sentByFilter = one(sp.sentby);
  const toNameFilter = one(sp.toname);

  const store = storeForAll(user.role);
  const [items, events, hubs, people] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("hubs"),
    store.list("people"),
  ]);

  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const hubCity = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));

  // Most recent event per item (by occurred_at), to read off its from_hub / hub route.
  const lastEvent = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    const prev = lastEvent.get(e.item_id);
    if (!prev || Date.parse(e.occurred_at || "0") >= Date.parse(prev.occurred_at || "0")) lastEvent.set(e.item_id, e);
  }

  const transiting = items.filter((i) => i.status === "traveling" || i.status === "pending");
  const allRows = transiting.map((i) => {
    const e = lastEvent.get(i.item_id);
    const fromHubId = e?.from_hub || "";
    const toHubId = e?.hub || i.current_hub;
    return {
      item_id: i.item_id,
      item_type: i.item_type,
      status: i.status,
      fromHub: hubName.get(fromHubId) ?? (fromHubId || "—"),
      fromCity: hubCity.get(fromHubId) ?? "",
      toHub: hubName.get(toHubId) ?? (toHubId || "—"),
      toCity: hubCity.get(toHubId) ?? "",
      sentBy: e?.from_person || personName.get(e?.from_id ?? "") || e?.recorded_by || "—",
      toName: e?.to_person || personName.get(e?.to_id ?? "") || "—",
      sentAt: e?.occurred_at || i.updated_at,
    };
  });

  const byType = Object.entries(TYPE_NAME)
    .map(([value, label]) => ({ value, label, count: allRows.filter((r) => r.item_type === value).length }))
    .filter((t) => t.count > 0);
  const fromCities = [...new Set(allRows.map((r) => r.fromCity).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const toCities = [...new Set(allRows.map((r) => r.toCity).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sentByNames = [...new Set(allRows.map((r) => r.sentBy).filter((v) => v && v !== "—"))].sort((a, b) => a.localeCompare(b));
  const toNames = [...new Set(allRows.map((r) => r.toName).filter((v) => v && v !== "—"))].sort((a, b) => a.localeCompare(b));

  let rows = allRows;
  if (typeFilter) rows = rows.filter((r) => r.item_type === typeFilter);
  if (fromFilter) rows = rows.filter((r) => r.fromCity === fromFilter);
  if (toFilter) rows = rows.filter((r) => r.toCity === toFilter);
  if (sentByFilter) rows = rows.filter((r) => r.sentBy === sentByFilter);
  if (toNameFilter) rows = rows.filter((r) => r.toName === toNameFilter);
  rows = rows.slice().sort((a, b) => Date.parse(b.sentAt || "0") - Date.parse(a.sentAt || "0"));

  const keep = (extra: Record<string, string>) =>
    `/transit?${new URLSearchParams({
      ...(typeFilter && { type: typeFilter }),
      ...(fromFilter && { from: fromFilter }),
      ...(toFilter && { to: toFilter }),
      ...(sentByFilter && { sentby: sentByFilter }),
      ...(toNameFilter && { toname: toNameFilter }),
      ...extra,
    })}`;

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
        <BackLink /> · <Link href="/dashboard">Dashboard</Link>
      </p>
      <h1>In transit ({allRows.length})</h1>
      <p className={styles.muted}>Items currently moving between hubs — status traveling or pending.</p>

      <nav aria-label="Filter by item type" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0 10px" }}>
        <Link href={keep({ type: "" })} aria-current={!typeFilter ? "true" : undefined} style={chip(!typeFilter)}>
          All items · {allRows.length}
        </Link>
        {byType.map((t) => (
          <Link key={t.value} href={keep({ type: t.value })} aria-current={t.value === typeFilter ? "true" : undefined} style={chip(t.value === typeFilter)}>
            {t.label} · {t.count}
          </Link>
        ))}
      </nav>

      <form className={styles.row} method="get" style={{ margin: "0 0 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {typeFilter && <input type="hidden" name="type" value={typeFilter} />}
        <label style={{ fontSize: "0.85rem", color: "#334155" }}>
          From city{" "}
          <select name="from" defaultValue={fromFilter}>
            <option value="">All</option>
            {fromCities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: "0.85rem", color: "#334155" }}>
          To city{" "}
          <select name="to" defaultValue={toFilter}>
            <option value="">All</option>
            {toCities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: "0.85rem", color: "#334155" }}>
          Sent by{" "}
          <select name="sentby" defaultValue={sentByFilter}>
            <option value="">All</option>
            {sentByNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: "0.85rem", color: "#334155" }}>
          To{" "}
          <select name="toname" defaultValue={toNameFilter}>
            <option value="">All</option>
            {toNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
        {(typeFilter || fromFilter || toFilter || sentByFilter || toNameFilter) && <Link href="/transit">Clear all</Link>}
      </form>

      {rows.length === 0 ? (
        <p className={styles.muted}>No items in transit right now.</p>
      ) : (
        <div role="region" aria-label="In transit" tabIndex={0} style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Status</th>
                <th>From</th>
                <th>To</th>
                <th>Sent by</th>
                <th>To</th>
                <th>Sent at</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_id}>
                  <td>
                    <Link href={`/inventory/${encodeURIComponent(r.item_id)}`} style={{ fontWeight: 600 }}>
                      {r.item_id}
                    </Link>
                  </td>
                  <td>{TYPE_NAME[r.item_type] ?? r.item_type}</td>
                  <td>{r.status === "pending" ? "Pending" : "Traveling"}</td>
                  <td>
                    {r.fromHub}
                    {r.fromCity && <span style={{ color: "#64748b" }}> ({r.fromCity})</span>}
                  </td>
                  <td>
                    {r.toHub}
                    {r.toCity && <span style={{ color: "#64748b" }}> ({r.toCity})</span>}
                  </td>
                  <td>{r.sentBy}</td>
                  <td>{r.toName}</td>
                  <td>{r.sentAt ? formatIst(r.sentAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
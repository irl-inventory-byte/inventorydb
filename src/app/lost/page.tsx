import Link from "next/link";
import type { CSSProperties } from "react";
import { storeForAll, VIEW_ROLES } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { lostList, notesFor } from "@/lib/lost";
import { one } from "@/lib/labels";
import { formatIst } from "@/lib/time";
import styles from "../admin/admin.module.css";
import { addLostNote } from "./actions";
import ReportLostScan from "./ReportLostScan";
import BackLink from "../BackLink";

const TYPE_NAME: Record<string, string> = { sd_card: "SD card", rig: "Rig", mobile: "Mobile", power_bank: "Power Bank" };

const money = (v: string) => (v ? `₹${Number(v).toLocaleString("en-IN")}` : "—");

/**
 * LOST ITEMS: the detail view behind the dashboard's "Lost" (and, with ?status=damaged, "Broken")
 * tile. Date, who last held the item, who recorded it, city/hub, item, amount, and a free-text
 * investigation-notes thread per item (Admin/IM can add to it). Filterable by item type.
 */
export default async function LostItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(...VIEW_ROLES);
  const canAddNote = user.role === "admin" || user.role === "im";
  const sp = await searchParams;
  const statusRaw = one(sp.status);
  const status = statusRaw === "damaged" ? "damaged" : "lost";
  const typeFilter = one(sp.type);
  const noteError = one(sp.error);
  const openItem = one(sp.item);
  const reported = Number(one(sp.reported) || "0");

  const store = storeForAll(user.role);
  const [items, events, hubs, notes, people] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("hubs"),
    store.list("lost_notes"),
    store.list("people"),
  ]);

  const all = lostList(items, events, hubs, status);
  const byType = Object.entries(TYPE_NAME)
    .map(([value, label]) => ({ value, label, count: all.filter((r) => r.item_type === value).length }))
    .filter((t) => t.count > 0);
  const rows = typeFilter ? all.filter((r) => r.item_type === typeFilter) : all;

  const title = status === "damaged" ? "Broken items" : "Lost items";
  const otherStatus = status === "damaged" ? "lost" : "damaged";
  const otherTitle = status === "damaged" ? "Lost" : "Broken";

  const keep = (extra: Record<string, string>) =>
    `/lost?${new URLSearchParams({ status, ...(typeFilter && { type: typeFilter }), ...extra })}`;

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
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <BackLink /> · <Link href="/dashboard">Dashboard</Link>
      </p>
      <h1>
        {title} ({all.length})
      </h1>
      <p className={styles.muted}>
        {status === "damaged"
          ? "Physically damaged and unusable, but its location is known."
          : "Can't be found — not with any person or hub, and location is unknown."}{" "}
        Date and the original note come from when the item was marked {status === "damaged" ? "broken" : "lost"};
        add further investigation notes below as you learn more. ·{" "}
        <Link href={`/lost?status=${otherStatus}`}>See {otherTitle.toLowerCase()} items instead</Link>
      </p>

      {noteError && (
        <p style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: "8px 12px" }}>
          {noteError}
        </p>
      )}

      {reported > 0 && (
        <p style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", borderRadius: 8, padding: "8px 12px" }}>
          Reported {reported} item{reported === 1 ? "" : "s"} {status === "damaged" ? "broken" : "lost"}.
        </p>
      )}

      {canAddNote && (
        <ReportLostScan
          status={status}
          items={items.map((i) => ({ id: i.item_id, status: i.status, type: i.item_type }))}
          hubs={hubs
            .filter((h) => h.active !== "false")
            .map((h) => ({ id: h.hub_id, name: h.name, city: (h.city || h.name || h.hub_id).trim() }))
            .sort((a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name))}
          people={people
            .filter((p) => p.active !== "false")
            .map((p) => ({ id: p.person_id, name: p.name, role: p.role }))
            .sort((a, b) => a.name.localeCompare(b.name))}
        />
      )}

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
        <p className={styles.muted}>No {title.toLowerCase()} right now.</p>
      ) : (
        <div role="region" aria-label={title} tabIndex={0} style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Type</th>
                <th>City</th>
                <th>Hub</th>
                <th>Person(s)</th>
                <th>Amount</th>
                <th>Investigation notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const history = notesFor(notes, r.item_id);
                const people = [r.lastHeldBy && `Last held by ${r.lastHeldBy}`, r.recordedBy && `Recorded by ${r.recordedBy}`]
                  .filter(Boolean)
                  .join(" · ");
                return (
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
                    <td>{people || "—"}</td>
                    <td>{money(r.amount)}</td>
                    <td style={{ minWidth: 260 }}>
                      <details open={openItem === r.item_id}>
                        <summary style={{ cursor: "pointer" }}>
                          {r.initialNote ? r.initialNote : "No note"}
                          {history.length > 0 && ` · +${history.length} update${history.length === 1 ? "" : "s"}`}
                        </summary>
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                          {r.initialNote && (
                            <p style={{ margin: 0 }}>
                              <strong>At the time:</strong> {r.initialNote}
                            </p>
                          )}
                          {history.map((n) => (
                            <p key={n.note_id} style={{ margin: 0 }}>
                              <strong>{formatIst(n.recorded_at)}</strong> ({n.recorded_by_name || n.recorded_by}): {n.note}
                            </p>
                          ))}
                          {canAddNote && (
                            <form action={addLostNote} style={{ display: "flex", gap: 6, marginTop: 4 }} data-progress="1">
                              <input type="hidden" name="item" value={r.item_id} />
                              <input type="hidden" name="status" value={status} />
                              <input
                                name="note"
                                placeholder="Add an investigation note…"
                                style={{ flex: 1, minWidth: 160 }}
                                aria-label={`Add a note for ${r.item_id}`}
                              />
                              <button type="submit">Add note</button>
                            </form>
                          )}
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
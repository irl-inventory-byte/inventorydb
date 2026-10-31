import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { ROLE_LABELS, one } from "@/lib/labels";
import type { ItemEvent, Role } from "@/lib/schema";
import { VIEW_ROLES, storeForAll } from "@/lib/access";
import { formatIst, istDate } from "@/lib/time";
import styles from "../../admin/admin.module.css";
import { deleteReceipt, restoreReceipt, updateReceiptNote } from "./actions";

const PAGE_SIZE = 50;

const TYPE_LABEL: Record<string, string> = {
  check_out: "Send",
  receive: "Receive",
  correct: "Correction",
  import: "Added",
  retire: "Dead / Retired",
  rnd: "R&D",
  report_lost: "Lost",
  report_damaged: "Damaged",
  reassign_home_hub: "Home hub changed",
};

// Fields in each filter (and the page links), in the address bar: ?q=&type=&city=&role=&person=&from=&to=
const FILTER_KEYS = ["q", "type", "city", "role", "person", "from", "to"] as const;
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

const actionLink = {
  display: "inline-block",
  padding: "4px 10px",
  border: "1px solid #94a3b8",
  borderRadius: 6,
  fontSize: 13,
  textDecoration: "none",
  whiteSpace: "nowrap",
} as const;

/**
 * RECEIPTS
 * Everyone (admin, IM, rig team): view and download receipts.
 * Admin only: edit the note, delete (hide) and restore receipts.
 * Every admin change is logged in the "receipt_edits" tab.
 */
export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}) {
  const user = await requireRole(...VIEW_ROLES);
  const isAdmin = user.role === "admin";

  const sp = (await searchParams) ?? {};
  const q = one(sp.q).trim().toLowerCase();
  const type = one(sp.type);
  // Filters: city (of the From or To hub), role and name (of the From or To person), date range, action.
  const cityF = one(sp.city);
  const roleF = one(sp.role);
  const personF = one(sp.person);
  const fromF = isDay(one(sp.from)) ? one(sp.from) : "";
  const toF = isDay(one(sp.to)) ? one(sp.to) : "";
  const showDeleted = isAdmin && one(sp.deletedView) === "1";
  const requestedPage = Number(one(sp.page)) || 1;

  const store = storeForAll(user.role); // SD cards, rigs and mobiles together
  const [events, hubs, people, edits, acknowledgments] = await Promise.all([
    store.list("events"),
    store.list("hubs"),
    store.list("people"),
    // The tab is created on the first edit, so it may not exist yet.
    store.list("receipt_edits").catch(() => []),
    store.list("acknowledgments").catch(() => []),
  ]);

  // One acknowledgment row per batch at most (see lib/acknowledgment.ts). Batches that never got an
  // acknowledgment ask (corrections, returns to stock, and anything before this feature existed) have
  // no row here at all.
  const ackByBatch = new Map(acknowledgments.map((a) => [a.batch_id, a]));

  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const hub = (id: string) => (id ? (hubName.get(id) ?? id) : "");
  // A hub's city: its City, or its name when City is blank.
  const hubCity = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));
  const roleOf = new Map(people.map((p) => [p.person_id, p.role]));

  // One receipt per batch.
  const byBatch = new Map<string, ItemEvent[]>();
  for (const e of events) {
    if (!e.batch_id) continue;
    const list = byBatch.get(e.batch_id) ?? [];
    list.push(e);
    byBatch.set(e.batch_id, list);
  }

  // Edit log per batch, newest first.
  const editsByBatch = new Map<string, typeof edits>();
  for (const ed of [...edits].sort(
    (a, b) => Date.parse(b.edited_at) - Date.parse(a.edited_at)
  )) {
    const list = editsByBatch.get(ed.batch_id) ?? [];
    list.push(ed);
    editsByBatch.set(ed.batch_id, list);
  }

  const all = [...byBatch.entries()].map(([batchId, rows]) => {
    const first = rows[0];
    const log = editsByBatch.get(batchId) ?? [];
    const lastDelete = log.find((ed) => ed.field === "deleted");
    const deleted = Boolean(lastDelete && lastDelete.new_value.startsWith("yes"));
    const lastNoteEdit = log.find((ed) => ed.field === "note");

    return {
      batchId,
      action: first.action,
      occurredAt: first.occurred_at,
      fromName: first.from_person,
      fromHub: hub(first.from_hub),
      toName: first.to_person,
      toHub: hub(first.hub),
      // For the filters: both cities, both roles and both names on the receipt, and its IST day.
      cities: [hubCity.get(first.from_hub), hubCity.get(first.hub)].filter((c): c is string => !!c),
      roles: [roleOf.get(first.from_id), roleOf.get(first.to_id)].filter((r): r is Role => !!r),
      names: [first.from_person, first.to_person].map((n) => (n ?? "").trim()).filter(Boolean),
      day: (() => {
        const t = Date.parse(first.occurred_at);
        return Number.isNaN(t) ? "" : istDate(new Date(t));
      })(),
      items: rows.map((r) => r.item_id),
      recordedBy: first.recorded_by,
      note: first.note,
      ack: ackByBatch.get(batchId),
      deleted,
      deletedBy: deleted ? lastDelete : undefined,
      lastNoteEdit,
    };
  });

  const deletedCount = all.filter((r) => r.deleted).length;

  const receipts = all
    // IM / rig team never see deleted receipts. Admins see them on request.
    .filter((r) => (showDeleted ? r.deleted : !r.deleted))
    .filter((r) => !type || r.action === type)
    .filter((r) => !cityF || r.cities.includes(cityF))
    .filter((r) => !roleF || r.roles.includes(roleF as Role))
    .filter((r) => !personF || r.names.includes(personF))
    .filter((r) => (!fromF || (r.day && r.day >= fromF)) && (!toF || (r.day && r.day <= toF)))
    .filter(
      (r) =>
        !q ||
        r.batchId.toLowerCase().includes(q) ||
        r.fromName.toLowerCase().includes(q) ||
        r.toName.toLowerCase().includes(q) ||
        r.recordedBy.toLowerCase().includes(q) ||
        r.note.toLowerCase().includes(q) ||
        r.items.some((id) => id.toLowerCase().includes(q))
    )
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  const pages = Math.max(1, Math.ceil(receipts.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), pages);
  const shown = receipts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Choices for the filter lists, from the receipts that exist (deleted ones as they are being viewed).
  const pool = all.filter((r) => (showDeleted ? r.deleted : !r.deleted));
  const sortText = (list: Iterable<string>) => [...new Set(list)].sort((a, b) => a.localeCompare(b));
  const cityOptions = sortText(pool.flatMap((r) => r.cities));
  const roleOptions = sortText(pool.flatMap((r) => r.roles));
  // With a role chosen, the name list shows only people of that role.
  const nameOptions = sortText(
    roleF
      ? people.filter((p) => p.role === roleF).map((p) => p.name.trim()).filter((n) => pool.some((r) => r.names.includes(n)))
      : pool.flatMap((r) => r.names),
  );
  const typeOptions = sortText(pool.map((r) => r.action));
  const filters: Record<string, string> = { q: one(sp.q).trim(), type, city: cityF, role: roleF, person: personF, from: fromF, to: toF };
  const filtered = FILTER_KEYS.some((k) => filters[k]);

  const link = (params: Record<string, string>) =>
    `/handover/receipts?${new URLSearchParams({
      ...Object.fromEntries(FILTER_KEYS.filter((k) => filters[k]).map((k) => [k, filters[k]])),
      ...(showDeleted && { deletedView: "1" }),
      ...params,
    })}`;

  const here = link({ page: String(page) });

  const saved = one(sp.saved);
  const deletedMsg = one(sp.deleted);
  const restored = one(sp.restored);
  const error = one(sp.error);

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/dashboard">← Dashboard</Link>
      </p>

      <h1>Receipts</h1>

      <p className={styles.muted}>
        Every send, receive and correction receipt, newest first. Anyone can
        view or download a receipt.
        {isAdmin
          ? " As an admin you can also edit the note or delete a receipt; every change is recorded with your name."
          : " Ask an admin if a receipt needs to be changed."}
      </p>

      {saved && <p className={styles.ok} role="status">Receipt {saved} saved.</p>}
      {deletedMsg && (
        <p className={styles.ok} role="status">
          Receipt {deletedMsg} deleted. Item history is unchanged; an admin can restore it from “Deleted receipts”.
        </p>
      )}
      {restored && <p className={styles.ok} role="status">Receipt {restored} restored.</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      <form method="get" className={styles.row} style={{ alignItems: "center" }}>
        <input
          name="q"
          defaultValue={one(sp.q)}
          placeholder="Search batch, serial, person, note or email"
          aria-label="Search receipts"
        />
        <select name="type" defaultValue={type} aria-label="Action">
          <option value="">All actions</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t] ?? t}
            </option>
          ))}
        </select>
        <select name="city" defaultValue={cityF} aria-label="City">
          <option value="">All cities</option>
          {cityOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select name="role" defaultValue={roleF} aria-label="Role">
          <option value="">All roles</option>
          {roleOptions.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r as Role] ?? r}
            </option>
          ))}
        </select>
        <input
          name="person"
          list="receipt-names"
          defaultValue={personF}
          aria-label="Name"
          placeholder="All names"
          style={{ maxWidth: 240 }}
        />
        <datalist id="receipt-names">
          {nameOptions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          From
          <input type="date" name="from" defaultValue={fromF} max={toF || undefined} aria-label="From date" />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          To
          <input type="date" name="to" defaultValue={toF} min={fromF || undefined} aria-label="To date" />
        </label>
        {showDeleted && <input type="hidden" name="deletedView" value="1" />}
        <button type="submit">Filter</button>
        {filtered && (
          <Link href={showDeleted ? "/handover/receipts?deletedView=1" : "/handover/receipts"}>Clear filters</Link>
        )}
      </form>
      <p className={styles.muted} style={{ marginTop: 0 }}>
        City, role and name match either side of the receipt (From or To). Pick a role first to shorten the name list,
        then press Filter.
      </p>

      {isAdmin && (
        <p className={styles.row}>
          {showDeleted ? (
            <Link href="/handover/receipts">← Back to receipts</Link>
          ) : (
            <Link href="/handover/receipts?deletedView=1">
              Deleted receipts ({deletedCount})
            </Link>
          )}
        </p>
      )}

      <p className={styles.muted}>
        {showDeleted ? "Deleted receipts: " : ""}
        {receipts.length} receipt{receipts.length === 1 ? "" : "s"}.
        {pages > 1 && ` Page ${page} of ${pages}.`}
      </p>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Date &amp; time (IST)</th>
              <th scope="col">Type</th>
              <th scope="col">Batch</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Items</th>
              <th scope="col">Recorded by</th>
              <th scope="col">Note</th>
              <th scope="col">Acknowledged</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>

          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={10} className={styles.muted}>
                  No receipts match.
                </td>
              </tr>
            ) : (
              shown.map((r) => {
                const enc = encodeURIComponent(r.batchId);
                return (
                  <tr key={r.batchId}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatIst(r.occurredAt)}</td>
                    <td>{TYPE_LABEL[r.action] ?? r.action}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.batchId}</td>
                    <td>
                      {r.fromName || "—"}
                      {r.fromHub && <div className={styles.muted}>{r.fromHub}</div>}
                    </td>
                    <td>
                      {r.toName || "—"}
                      {r.toHub && <div className={styles.muted}>{r.toHub}</div>}
                    </td>
                    <td>{r.items.length}</td>
                    <td style={{ overflowWrap: "anywhere" }}>{r.recordedBy || "—"}</td>
                    <td style={{ minWidth: 180 }}>
                      {r.note || <span className={styles.muted}>—</span>}
                      {r.lastNoteEdit && (
                        <div className={styles.muted} style={{ marginTop: 4 }}>
                          Note edited by {r.lastNoteEdit.edited_by_name || r.lastNoteEdit.edited_by_email},{" "}
                          {formatIst(r.lastNoteEdit.edited_at)}
                        </div>
                      )}
                      {r.deletedBy && (
                        <div className={styles.error} style={{ marginTop: 4 }}>
                          Deleted by {r.deletedBy.edited_by_name || r.deletedBy.edited_by_email},{" "}
                          {formatIst(r.deletedBy.edited_at)}
                          {r.deletedBy.new_value.length > 3 && ` (${r.deletedBy.new_value.slice(6)})`}
                        </div>
                      )}
                    </td>

                    <td style={{ whiteSpace: "nowrap" }}>
                      {!r.ack ? (
                        <span className={styles.muted}>—</span>
                      ) : r.ack.answer === "yes" ? (
                        <span style={{ color: "#15803D", fontWeight: 600 }}>Yes, acknowledged</span>
                      ) : (
                        <span style={{ color: "#B42318", fontWeight: 600 }}>Pending</span>
                      )}
                    </td>

                    <td>
                      {/* Everyone: view and download. */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        <Link href={`/handover/receipt/${enc}`} style={actionLink}>
                          View
                        </Link>
                        <a href={`/api/receipt-pdf/${enc}`} style={actionLink} download>
                          Download PDF
                        </a>
                      </div>

                      {/* Admin only: edit, delete, restore. */}
                      {isAdmin && !r.deleted && (
                        <>
                          <details style={{ marginTop: 6 }}>
                            <summary style={{ cursor: "pointer" }}>Edit note</summary>
                            <form action={updateReceiptNote} style={{ display: "grid", gap: 6, marginTop: 6 }}>
                              <input type="hidden" name="batch" value={r.batchId} />
                              <input type="hidden" name="back" value={here} />
                              <textarea
                                name="note"
                                defaultValue={r.note}
                                maxLength={1000}
                                rows={3}
                                aria-label={`Note for receipt ${r.batchId}`}
                                style={{ width: "100%", minWidth: 200, padding: 6 }}
                              />
                              <button type="submit">Save note</button>
                            </form>
                          </details>

                          <details style={{ marginTop: 6 }}>
                            <summary style={{ cursor: "pointer", color: "#b91c1c" }}>Delete</summary>
                            <form action={deleteReceipt} style={{ display: "grid", gap: 6, marginTop: 6 }}>
                              <input type="hidden" name="batch" value={r.batchId} />
                              <input type="hidden" name="back" value={here} />
                              <input
                                name="reason"
                                placeholder="Reason (optional)"
                                maxLength={500}
                                aria-label={`Reason for deleting ${r.batchId}`}
                              />
                              <button
                                type="submit"
                                style={{ background: "#b91c1c", borderColor: "#b91c1c", color: "#fff" }}
                              >
                                Delete receipt
                              </button>
                              <span className={styles.muted} style={{ fontSize: 12 }}>
                                Hides it for everyone. Item history is kept; you can restore it later.
                              </span>
                            </form>
                          </details>
                        </>
                      )}

                      {isAdmin && r.deleted && (
                        <form action={restoreReceipt} style={{ marginTop: 6 }}>
                          <input type="hidden" name="batch" value={r.batchId} />
                          <input type="hidden" name="back" value={here} />
                          <button type="submit">Restore</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <p className={styles.row}>
          {page > 1 && <Link href={link({ page: String(page - 1) })}>← Newer</Link>}
          {page < pages && <Link href={link({ page: String(page + 1) })}>Older →</Link>}
        </p>
      )}
    </main>
  );
}
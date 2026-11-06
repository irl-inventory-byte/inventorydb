import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { formatIst } from "@/lib/time";
import styles from "../admin.module.css";
import BackLink from "../../BackLink";

/**
 * Admin-only log of permanently deleted items.
 * Rows come from the "deletions" tab, written by the delete action.
 */
export default async function DeletionsPage() {
  await requireRole("admin");

  const store = getStore();

  // The tab is created on the first deletion, so it may not exist yet.
  const [deletions, hubs, people] = await Promise.all([
    store.list("deletions").catch(() => []),
    store.list("hubs"),
    store.list("people"),
  ]);

  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));

  // Newest first.
  const rows = [...deletions].sort(
    (a, b) => Date.parse(b.deleted_at) - Date.parse(a.deleted_at)
  );

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <BackLink />
      </p>

      <h1>Deleted items log</h1>

      <p className={styles.muted}>
        Every permanent deletion, with the admin who did it. The item and its
        history are removed from Inventory; this log keeps a snapshot of them.
        {" "}
        {rows.length} deletion{rows.length === 1 ? "" : "s"}.
      </p>

      <div style={{ width: "100%", overflowX: "auto" }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Deleted at</th>
              <th scope="col">Deleted by</th>
              <th scope="col">Serial</th>
              <th scope="col">Prism no.</th>
              <th scope="col">Model</th>
              <th scope="col">Status when deleted</th>
              <th scope="col">Hub / holder when deleted</th>
              <th scope="col">History rows deleted</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>

          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className={styles.muted}>
                  No items have been deleted yet.
                </td>
              </tr>
            ) : (
              rows.map((d) => (
                <tr key={d.deletion_id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {formatIst(d.deleted_at)} IST
                  </td>
                  <td>
                    {d.deleted_by_name || "—"}
                    <div className={styles.muted}>{d.deleted_by_email}</div>
                  </td>
                  <td style={{ overflowWrap: "anywhere" }}>{d.item_id}</td>
                  <td>{d.prism_no || "—"}</td>
                  <td>{d.model || d.brand || "—"}</td>
                  <td>{d.status || "—"}</td>
                  <td>
                    {hubName.get(d.current_hub) ?? (d.current_hub || "—")}
                    {d.current_holder && (
                      <div className={styles.muted}>
                        {personName.get(d.current_holder) ?? d.current_holder}
                      </div>
                    )}
                  </td>
                  <td>{d.events_deleted || "0"}</td>
                  <td>{d.reason || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
import Link from "next/link";
import { storeFor } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { STATUS_LABELS, one } from "@/lib/labels";
import type { HardwareUpdate, QcCheck } from "@/lib/schema";
import { RIG_STATES, RIG_STATE_LABELS, rigCondition, rigState, type RigState } from "@/lib/rig-state";
import { formatIst } from "@/lib/time";
import styles from "../admin/admin.module.css";

const QC_COLOR: Record<string, string> = {
  pass: "#15803D",
  fail: "#B42318",
  qc_pending: "#8A4B00",
  repaired: "#15803D",
};

const FILTERS: [string, string][] = [
  ["", "All rigs"],
  ["qc_pending", "QC pending"],
  ["pass", "Pass"],
  ["fail", "Fail"],
  ["repaired", "Repaired"],
];

/**
 * RIG CHECKS: every rig with its latest QC result and hardware update.
 * Admin, IM, Hardware team and QC team. Open a rig to add an update or QC result.
 */
export default async function RigsPage({ searchParams }: PageProps<"/">) {
  const user = await requireRole("admin", "im", "hardware", "qc");
  const sp = await searchParams;
  const qcFilter = one(sp.qc);
  // ?ready=1: in stock and QC passed or repaired (the dashboard's "Ready for field" tile).
  const readyOnly = one(sp.ready) === "1";
  // ?state=…: one rig state from the dashboard tiles (In stock, QC pending, RTD, …).
  const stateFilter = (RIG_STATES as readonly string[]).includes(one(sp.state)) ? (one(sp.state) as RigState) : "";
  const q = one(sp.q).trim().toLowerCase();

  const store = storeFor(user.role, "rig");
  const [rigs, hubs, people, qcChecks, hardware] = await Promise.all([
    store.list("items"),
    store.list("hubs"),
    store.list("people"),
    store.list("qc_checks"),
    store.list("hardware_updates"),
  ]);

  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));

  // Rows are stored oldest first, so the last one per rig is the latest.
  const latestQc = new Map<string, QcCheck>();
  for (const c of qcChecks) latestQc.set(c.item_id, c);
  const latestHw = new Map<string, HardwareUpdate>();
  for (const h of hardware) latestHw.set(h.item_id, h);

  const counts = { qc_pending: 0, pass: 0, fail: 0, repaired: 0 } as Record<string, number>;
  for (const r of rigs) {
    const st = latestQc.get(r.item_id)?.qc_status ?? "qc_pending";
    counts[st] = (counts[st] ?? 0) + 1;
  }

  const shown = rigs
    .filter((r) => !qcFilter || (latestQc.get(r.item_id)?.qc_status ?? "qc_pending") === qcFilter)
    .filter((r) => !stateFilter || rigState(r.status, latestQc.get(r.item_id)?.qc_status) === stateFilter)
    .filter((r) => !readyOnly || (r.status === "in_stock" && rigCondition(r.status, latestQc.get(r.item_id)?.qc_status).ready))
    .filter(
      (r) =>
        !q ||
        [r.item_id, r.prism_no, r.brand, r.model].some((v) => (v ?? "").toLowerCase().includes(q))
    )
    .sort((a, b) => a.item_id.localeCompare(b.item_id));

  const link = (qc: string) => {
    const params = new URLSearchParams({ ...(qc && { qc }), ...(q && { q }) });
    const s = params.toString();
    return s ? `/rigs?${s}` : "/rigs";
  };

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link>
      </p>
      <h1>Rig checks</h1>
      <p className={styles.muted}>
        {rigs.length} rigs · {counts.qc_pending ?? 0} QC pending · {counts.pass ?? 0} pass · {counts.fail ?? 0} fail · {counts.repaired ?? 0} repaired.
        Open a rig to add a hardware update or QC result.
        {stateFilter && (
          <>
            {" "}
            <strong>Showing only: {RIG_STATE_LABELS[stateFilter]}.</strong> <Link href="/rigs">Show all</Link>
          </>
        )}
        {readyOnly && (
          <>
            {" "}
            <strong>Showing only rigs ready for the field.</strong> <Link href="/rigs">Show all</Link>
          </>
        )}
      </p>

      <nav aria-label="QC filter" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
        {FILTERS.map(([value, label]) => (
          <Link
            key={value || "all"}
            href={link(value)}
            aria-current={qcFilter === value ? "page" : undefined}
            style={{
              padding: "8px 16px",
              minHeight: 40,
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 999,
              border: "1px solid currentColor",
              textDecoration: "none",
              fontWeight: qcFilter === value ? 700 : 400,
              opacity: qcFilter === value ? 1 : 0.7,
            }}
          >
            {label}
            {value ? ` (${counts[value] ?? 0})` : ` (${rigs.length})`}
          </Link>
        ))}
      </nav>

      <form className={styles.row} method="get">
        {qcFilter && <input type="hidden" name="qc" value={qcFilter} />}
        <input name="q" defaultValue={one(sp.q)} placeholder="Search rig ID, prism no., brand or model" aria-label="Search rigs" />
        <button type="submit">Search</button>
      </form>

      {shown.length === 0 ? (
        <p className={styles.muted}>No rigs match.</p>
      ) : (
        <div role="region" aria-label="Rigs" tabIndex={0} style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Rig</th>
                <th>Brand / Model</th>
                <th>Status</th>
                <th>Where</th>
                <th>QC</th>
                <th>Last QC</th>
                <th>Latest hardware update</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const qc = latestQc.get(r.item_id);
                const hw = latestHw.get(r.item_id);
                const qcStatus = qc?.qc_status ?? "qc_pending";
                return (
                  <tr key={r.item_id}>
                    <td>
                      <Link href={`/inventory/${encodeURIComponent(r.item_id)}`}>{r.item_id}</Link>
                    </td>
                    <td>{[r.brand, r.model].filter(Boolean).join(" ") || "—"}</td>
                    <td>
                      {rigState(r.status, qcStatus) === "other"
                        ? (STATUS_LABELS[r.status] ?? r.status)
                        : RIG_STATE_LABELS[rigState(r.status, qcStatus)]}
                    </td>
                    <td>
                      {personName.get(r.current_holder) ?? hubName.get(r.current_hub) ?? (r.current_hub || "—")}
                    </td>
                    <td style={{ color: QC_COLOR[qcStatus], fontWeight: 600 }}>{rigCondition(r.status, qcStatus).label}</td>
                    <td>
                      {qc ? (
                        <>
                          {formatIst(qc.recorded_at)}
                          {qc.comment ? ` · ${qc.comment}` : ""}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {hw ? (
                        <>
                          {formatIst(hw.recorded_at)} · {[hw.update_type, hw.comment].filter(Boolean).join(": ")}
                        </>
                      ) : (
                        "—"
                      )}
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
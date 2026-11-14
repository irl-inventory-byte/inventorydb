import Link from "next/link";
import { notFound } from "next/navigation";
import { parseAttributes } from "@/lib/attributes";
import { requireRole } from "@/lib/authz";
import { HARDWARE_ROLES, QC_ROLES, itemType, storeForAll } from "@/lib/access";
import { ITEM_TYPE_LABELS, QC_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import type { HardwareUpdate, QcCheck } from "@/lib/schema";
import { formatIst } from "@/lib/time";
import styles from "../../admin/admin.module.css";
import { applyCorrection } from "../actions";
import CorrectionPanel from "../CorrectionPanel";
import RigChecks from "./RigChecks";

type InventoryItemPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ItemPage({ params, searchParams }: InventoryItemPageProps) {
  const user = await requireRole();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  // Only items of a type this login may see; anything else is "not found".
  const store = storeForAll(user.role);
  // store.getItem() is an exact, case-sensitive match on item_id — which 404s on a perfectly real item
  // whenever the id in the URL doesn't match byte-for-byte: different letter case, stray leading/trailing
  // whitespace, or the browser/another page encoding a space or special character differently than this
  // route decodes it. decodeURIComponent is tried too, since an id with a space or "-" sometimes arrives
  // double-encoded from a Link built with a template string instead of encodeURIComponent. Falls back to
  // a case-insensitive, trimmed match across every item before finally giving up with notFound().
  let item = await store.getItem(id);
  if (!item) {
    let decoded = id;
    try {
      decoded = decodeURIComponent(id);
    } catch {
      // Not valid percent-encoding — fall through and try the raw id as-is below.
    }
    const wanted = decoded.trim().toUpperCase();
    const items = await store.list("items");
    item = items.find((i) => i.item_id.trim().toUpperCase() === wanted);
  }
  if (!item) notFound();
  const isRig = itemType(item) === "rig";
  const isMobile = itemType(item) === "mobile";
  const isPowerBank = itemType(item) === "power_bank";

  const [hubs, people, history, hardware, qc, audits] = await Promise.all([
    store.list("hubs"),
    store.list("people"),
    store.getHistory(item.item_id), // the resolved item's real id, not the raw URL param — see the tolerant lookup above
    isRig ? store.list("hardware_updates") : Promise.resolve([] as HardwareUpdate[]),
    isRig ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
    store.list("audits"),
  ]);
  const hardwareUpdates = hardware.filter((h) => h.item_id === item.item_id);
  const qcChecks = qc.filter((c) => c.item_id === item.item_id);
  const auditRows = audits.filter((a) => a.item_id === item.item_id);
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));
  // City/Hub Audit confirmations merged into History as their own kind of row (no status change).
  type HistoryRow = {
    key: string;
    when: string;
    action: string;
    from: string;
    to: string;
    hub: string;
    status: string;
    by: string;
    note: string;
  };
  const historyRows: HistoryRow[] = [
    ...history.map((e) => ({
      key: e.event_id,
      when: e.occurred_at,
      action: e.action,
      from: personName.get(e.from_person) ?? (e.from_person || "—"),
      to: personName.get(e.to_person) ?? (e.to_person || "—"),
      hub: hubName.get(e.hub) ?? e.hub,
      status: STATUS_LABELS[e.status_after] ?? e.status_after,
      by: e.recorded_by,
      note: e.note,
    })),
    ...auditRows.map((a) => ({
      key: a.audit_id,
      when: a.audited_at,
      action: "audited",
      from: "—",
      to: "—",
      hub: hubName.get(item.current_hub) ?? item.current_hub,
      status: STATUS_LABELS[item.status] ?? item.status,
      by: a.audited_by_name || a.audited_by,
      note: "Confirmed present during a City / Hub Audit.",
    })),
  ].sort((a, b) => Date.parse(a.when || "0") - Date.parse(b.when || "0"));
  const latestQc = qcChecks.at(-1);
  const attrs = parseAttributes(item.attributes);
  // History sort order: newest first by default; ?sort=asc switches to oldest first.
  const sortAsc = one(sp.sort) === "asc";
  const sortedHistory = sortAsc ? historyRows : [...historyRows].reverse();
  const sortHref = (asc: boolean) => `?${new URLSearchParams({ ...(asc && { sort: "asc" }) })}`;
  const sortChip = (on: boolean) => ({
    padding: "5px 12px",
    borderRadius: 999,
    border: "1px solid #cbd5e1",
    background: on ? "#1e293b" : "#ffffff",
    color: on ? "#ffffff" : "#334155",
    textDecoration: "none",
    fontWeight: on ? 700 : 500,
    fontSize: "0.82rem",
  });

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <Link href={isMobile ? "/inventory?type=mobile" : isPowerBank ? "/inventory?type=power_bank" : "/inventory"}>
          ← Inventory
        </Link>
      </p>
      <h1>{item.item_id}</h1>
      {one(sp.done) && <p className={styles.ok}>Saved.</p>}
      {isRig && (
        <p className={styles.muted}>
          Rig · QC status:{" "}
          <strong>{latestQc ? QC_LABELS[latestQc.qc_status] ?? latestQc.qc_status : "No QC yet"}</strong>
        </p>
      )}
      {one(sp.error) && <p className={styles.error}>{one(sp.error)}</p>}

      <dl className={styles.facts}>
        <dt>Status</dt>
        <dd>{STATUS_LABELS[item.status] ?? item.status}</dd>
        <dt>Current hub</dt>
        <dd>{hubName.get(item.current_hub) ?? item.current_hub}</dd>
        <dt>Holder</dt>
        <dd>{personName.get(item.current_holder) ?? (item.current_holder || "—")}</dd>
        <dt>Home hub</dt>
        <dd>{hubName.get(item.home_hub) ?? item.home_hub}</dd>
        {!isMobile && !isPowerBank && (
          <>
            <dt>Prism no.</dt>
            <dd>{item.prism_no || "—"}</dd>
          </>
        )}
        {isMobile && (
          <>
            <dt>IMEI</dt>
            <dd>{item.item_id}</dd>
            <dt>Cost</dt>
            <dd>{item.price ? `₹${Number(item.price).toLocaleString("en-IN")}` : "—"}</dd>
          </>
        )}
        {isPowerBank && (
          <>
            <dt>Asset Tag</dt>
            <dd>{item.item_id}</dd>
            <dt>Price / Penalty</dt>
            <dd>{item.price ? `₹${Number(item.price).toLocaleString("en-IN")}` : "—"}</dd>
          </>
        )}
        <dt>{isMobile ? "Manufacturer" : "Brand"}</dt>
        <dd>{item.brand || "—"}</dd>
        <dt>Model</dt>
        <dd>{item.model || "—"}</dd>
        <dt>Type</dt>
        <dd>{ITEM_TYPE_LABELS[itemType(item)]}</dd>
        {typeof attrs === "string" ? (
          <>
            <dt>Details</dt>
            <dd>{attrs}</dd>
          </>
        ) : (
          attrs.map(([k, v]) => (
            <div key={k} className={styles.factRow}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))
        )}
      </dl>

      {user.role === "admin" && (
        <form action={applyCorrection} className={styles.list}>
          <input type="hidden" name="back" value={`/inventory/${item.item_id}`} />
          <input type="hidden" name="ids" value={item.item_id} />
          <CorrectionPanel hubs={hubs} people={people} showScan={false} />
        </form>
      )}

      {isRig && (
        <RigChecks
          itemId={item.item_id}
          hardwareUpdates={hardwareUpdates}
          qcChecks={qcChecks}
          canHardware={HARDWARE_ROLES.includes(user.role)}
          canRetire={HARDWARE_ROLES.includes(user.role) && item.status === "with_hardware"}
          canQc={QC_ROLES.includes(user.role)}
        />
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>History</h2>
        {historyRows.length > 1 && (
          <nav aria-label="Sort history" style={{ display: "flex", gap: 6 }}>
            <Link href={sortHref(false)} aria-current={!sortAsc ? "true" : undefined} style={sortChip(!sortAsc)}>
              Newest first
            </Link>
            <Link href={sortHref(true)} aria-current={sortAsc ? "true" : undefined} style={sortChip(sortAsc)}>
              Oldest first
            </Link>
          </nav>
        )}
      </div>
      {historyRows.length === 0 ? (
        <p className={styles.muted}>No events yet. History starts with the first handover, correction or audit.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>From → To</th>
              <th>Hub</th>
              <th>Status</th>
              <th>By</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {sortedHistory.map((r) => (
              <tr key={r.key}>
                <td>{formatIst(r.when)} IST</td>
                <td>{r.action}</td>
                <td>
                  {r.from} → {r.to}
                </td>
                <td>{r.hub}</td>
                <td>{r.status}</td>
                <td>{r.by}</td>
                <td>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
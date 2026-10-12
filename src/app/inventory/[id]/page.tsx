import Link from "next/link";
import { notFound } from "next/navigation";
import { parseAttributes } from "@/lib/attributes";
import { requireRole } from "@/lib/authz";
import { HARDWARE_ROLES, QC_ROLES, itemType, storeFor } from "@/lib/access";
import { ITEM_TYPE_LABELS, QC_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import type { HardwareUpdate, QcCheck } from "@/lib/schema";
import { formatIst } from "@/lib/time";
import styles from "../../admin/admin.module.css";
import { applyCorrection } from "../actions";
import CorrectionPanel from "../CorrectionPanel";
import RigChecks from "./RigChecks";

export default async function ItemPage({ params, searchParams }: PageProps<"/inventory/[id]">) {
  const user = await requireRole();
  const { id } = await params;
  const sp = await searchParams;
  // Only items of a type this login may see; anything else is "not found".
  const store = storeFor(user.role);
  const item = await store.getItem(id);
  if (!item) notFound();
  const isRig = itemType(item) === "rig";

  const [hubs, people, history, hardware, qc] = await Promise.all([
    store.list("hubs"),
    store.list("people"),
    store.getHistory(id),
    isRig ? store.list("hardware_updates") : Promise.resolve([] as HardwareUpdate[]),
    isRig ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
  ]);
  const hardwareUpdates = hardware.filter((h) => h.item_id === item.item_id);
  const qcChecks = qc.filter((c) => c.item_id === item.item_id);
  const latestQc = qcChecks.at(-1);
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const personName = new Map(people.map((p) => [p.person_id, p.name]));
  const attrs = parseAttributes(item.attributes);

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <Link href="/inventory">← Inventory</Link>
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
        <dt>Prism no.</dt>
        <dd>{item.prism_no || "—"}</dd>
        <dt>Brand</dt>
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
          canQc={QC_ROLES.includes(user.role)}
        />
      )}

      <h2>History</h2>
      {history.length === 0 ? (
        <p className={styles.muted}>No events yet. History starts with the first handover or correction.</p>
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
            {[...history].reverse().map((e) => (
              <tr key={e.event_id}>
                <td>{formatIst(e.occurred_at)} IST</td>
                <td>{e.action}</td>
                <td>
                  {personName.get(e.from_person) ?? (e.from_person || "—")} → {personName.get(e.to_person) ?? (e.to_person || "—")}
                </td>
                <td>{hubName.get(e.hub) ?? e.hub}</td>
                <td>{STATUS_LABELS[e.status_after] ?? e.status_after}</td>
                <td>{e.recorded_by}</td>
                <td>{e.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
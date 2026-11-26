import Link from "next/link";
import { storeFor } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { one, STATUS_LABELS } from "@/lib/labels";
import styles from "../../admin/admin.module.css";
import BackLink from "../../BackLink";
import RetireRigsScan from "./RetireRigsScan";

/**
 * DEAD RIGS: bulk version of the "Declare dead / Retire" button on a single rig's own page
 * (inventory/[id]/RigChecks.tsx). Admin, IM and the Hardware team scan/paste several rig codes at
 * once instead of opening each rig individually — same underlying rule (retireRigsBulk in
 * ../../inventory/rig-actions.ts): Admin/IM can declare any rig dead from anywhere (with an FO, in
 * stock, in transit — any status except already-retired), no location restriction. A Hardware login
 * stays restricted to a rig currently "with_hardware" and checked out to them personally.
 */
export default async function RetireRigsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("admin", "im", "hardware");
  const sp = await searchParams;
  const error = one(sp.error);
  const retired = Number(one(sp.retired) || "0");
  const skipped = Number(one(sp.skipped) || "0");
  const missing = Number(one(sp.missing) || "0");

  const store = storeFor(user.role, "rig");
  const [rigs, hubs] = await Promise.all([store.list("items"), store.list("hubs")]);
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));

  // What this login may actually retire here, same restriction retireRigsBulk() itself enforces:
  // Admin/IM can declare any non-retired rig dead regardless of status or location; a Hardware login
  // only sees (and can retire) rigs currently with_hardware AND checked out to them personally.
  const eligible =
    user.role === "hardware"
      ? rigs.filter((r) => r.status === "with_hardware" && (!user.personId || r.current_holder === user.personId))
      : rigs.filter((r) => r.status !== "retired");

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <BackLink />
      </p>
      <h1>Dead rigs</h1>
      <p className={styles.muted}>
        Scan or paste the codes of rigs that are beyond repair.{" "}
        {user.role === "hardware"
          ? "Only a rig currently with the hardware team, and checked out to you, can be retired this way."
          : "Any rig not already retired can be declared dead here, wherever it currently is — with an FO, in stock, in transit, anywhere."}
      </p>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {retired > 0 && (
        <p className={styles.ok} role="status">
          Retired {retired} rig{retired === 1 ? "" : "s"}.
          {skipped > 0 && ` ${skipped} skipped (not eligible).`}
          {missing > 0 && ` ${missing} not found.`}
        </p>
      )}

      <RetireRigsScan rigs={eligible.map((r) => ({ id: r.item_id, hub: hubName.get(r.current_hub) ?? r.current_hub }))} />

      <h2 style={{ marginTop: 28 }}>
        Rigs you can retire right now ({eligible.length})
      </h2>
      {eligible.length === 0 ? (
        <p className={styles.muted}>
          {user.role === "hardware" ? "No rig is currently with the hardware team under your name." : "Every rig is already retired."}
        </p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Rig</th>
              <th>Status</th>
              <th>Hub</th>
            </tr>
          </thead>
          <tbody>
            {eligible.map((r) => (
              <tr key={r.item_id}>
                <td>
                  <Link href={`/inventory/${encodeURIComponent(r.item_id)}?type=rig`}>{r.item_id}</Link>
                </td>
                <td>{STATUS_LABELS[r.status] ?? r.status}</td>
                <td>{hubName.get(r.current_hub) ?? r.current_hub}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
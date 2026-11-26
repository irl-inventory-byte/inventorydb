import Link from "next/link";
import { storeFor } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import styles from "../../admin/admin.module.css";
import BackLink from "../../BackLink";
import RetireRigsScan from "./RetireRigsScan";

/**
 * DEAD RIGS: bulk version of the "Declare dead / Retire" button on a single rig's own page
 * (inventory/[id]/RigChecks.tsx). Admin, IM and the Hardware team scan/paste several rig codes at
 * once instead of opening each rig individually — same underlying rule (retireRigsBulk in
 * ../../inventory/rig-actions.ts): only a rig currently "with_hardware" can be retired this way, and
 * a Hardware login may only retire rigs the system shows as checked out to them personally.
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

  // What this login may actually retire here: a Hardware login only sees (and can retire) rigs
  // checked out to them personally, same restriction the action itself enforces.
  const eligible = rigs.filter(
    (r) => r.status === "with_hardware" && (user.role !== "hardware" || !user.personId || r.current_holder === user.personId),
  );

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <BackLink />
      </p>
      <h1>Dead rigs</h1>
      <p className={styles.muted}>
        Scan or paste the codes of rigs that are beyond repair. Only a rig currently with the hardware team can be
        retired this way
        {user.role === "hardware" ? " — and only one checked out to you." : "."}
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
        <p className={styles.muted}>No rig is currently with the hardware team{user.role === "hardware" ? " under your name" : ""}.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Rig</th>
              <th>Hub</th>
            </tr>
          </thead>
          <tbody>
            {eligible.map((r) => (
              <tr key={r.item_id}>
                <td>
                  <Link href={`/inventory/${encodeURIComponent(r.item_id)}?type=rig`}>{r.item_id}</Link>
                </td>
                <td>{hubName.get(r.current_hub) ?? r.current_hub}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
import { actorOptions, allowedActors, defaultActor } from "@/lib/actors";
import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { IC_TRANSFER_ROLES, handoverStoreFor } from "@/lib/access";
import { rigHomeHub } from "@/lib/rig-hub";
import { mobileAliases } from "@/lib/scan";
import styles from "../../handover/form.module.css";
import { transferToFo } from "../actions";
import BackLink from "../../BackLink";
import IcTransferFields from "./IcTransferFields";

export default async function IcTransferPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(...IC_TRANSFER_ROLES);
  const sp = await searchParams;
  const store = handoverStoreFor(user.role);
  const [people, hubs, users, items] = await Promise.all([
    store.list("people"),
    store.list("hubs"),
    store.list("users"),
    store.list("items"),
  ]);

  const bangalore = rigHomeHub(hubs);
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const byOptions = allowedActors(user, actorOptions(people, users, (id) => hubName.get(id) ?? id, ["ic"]));

  const scanItems = items
    .filter((i) => !bangalore || i.current_hub === bangalore.hub_id)
    .map((i) => ({
      id: i.item_id,
      status: i.status,
      hub: i.current_hub,
      type: i.item_type === "rig" || i.item_type === "mobile" ? i.item_type : "sd_card",
      ...(i.item_type === "mobile" && { aliases: mobileAliases(i.attributes) }),
    }));

  const fos = people
    .filter((p) => p.role === "fo" && p.active !== "false")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.person_id, label: `${p.name} (${hubName.get(p.hub) ?? p.hub})` }));

  const toPerson = people.find((p) => p.person_id === one(sp.person))?.name ?? one(sp.person);

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <BackLink />
      </p>
      <h1>Transfer to FO</h1>
      <p className={styles.hint}>
        Send items from Bangalore stock straight to a field officer. A receipt email with the item list
        goes to them automatically once you transfer.
      </p>

      {!bangalore && (
        <p className={styles.error}>No Bangalore hub found. Ask an admin to add one in Manage hubs before transferring.</p>
      )}

      <form action={transferToFo} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="by">
            Name
          </label>
          <div className={styles.control}>
            {byOptions.length ? (
              <>
                <strong id="by">{byOptions[0].label}</strong>
                <input type="hidden" name="by" value={byOptions[0].value} />
                <p className={styles.hint}>Transfers are recorded under your name.</p>
              </>
            ) : (
              <p className={styles.error}>
                Your login is not linked to an active person in People, so you can&apos;t transfer yet. Ask an admin to link you on the Users screen.
              </p>
            )}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Sending from</label>
          <div className={styles.control}>
            <strong>{bangalore?.name ?? "Bangalore"}</strong>
            <p className={styles.hint}>IC always sends from Bangalore stock.</p>
          </div>
        </div>

        <IcTransferFields items={scanItems} hubName={bangalore?.name ?? "Bangalore"} fos={fos} />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="note">
            Notes *
          </label>
          <div className={styles.control}>
            <textarea id="note" name="note" rows={3} className={styles.textarea} required />
            <p className={styles.hint}>Required — say what this transfer is for.</p>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit">Transfer</button>
        </div>

        {one(sp.done) && (
          <p className={`${styles.ok} ${styles.result}`}>
            Transferred {one(sp.done)} item(s) to {toPerson}. A receipt email has been sent to them.{" "}
            {one(sp.batch) && <a href={`/handover/receipt/${one(sp.batch)}`}>View / print receipt →</a>}
          </p>
        )}
        {one(sp.error) && <p className={`${styles.error} ${styles.result}`}>{one(sp.error)}</p>}
      </form>
    </main>
  );
}
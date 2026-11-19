import { requireRole } from "@/lib/authz";
import { one, ITEM_TYPE_LABELS } from "@/lib/labels";
import { IC_TRANSFER_ROLES, handoverStoreFor } from "@/lib/access";
import { formatIst } from "@/lib/time";
import styles from "../../handover/form.module.css";
import { transferFoToFo } from "../actions";
import BackLink from "../../BackLink";
import FromFoPicker from "./FromFoPicker";
import FoToFoFields, { type OverdueItem } from "./FoToFoFields";

const HOURS_48 = 48 * 60 * 60 * 1000;

// The original "Transfer to FO" (Bangalore stock → FO) flow — transferToFo in ../actions, the
// IcTransferFields component — is still in the codebase, just not rendered here any more: this page
// now only offers "Transfer between FOs". Removed, not deleted, in case it's wanted back later.
export default async function IcTransferPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole(...IC_TRANSFER_ROLES);
  const sp = await searchParams;
  const store = handoverStoreFor(user.role);
  const [people, hubs, items] = await Promise.all([
    store.list("people"),
    store.list("hubs"),
    store.list("items"),
  ]);

  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));

  // Who's actually recording this transfer — the signed-in person's real name when they're linked to
  // a People row, falling back to their login email (e.g. an Admin with no People link).
  const me = people.find((p) => p.person_id === user.personId);
  const loggedInAs = me?.name || user.email || "";

  // Every active FO, for both the "From" picker above and the "Send to" picker below — same shape
  // both pickers already used ("city" here is really the hub's name, same convention the recipient
  // picker used before this change; kept as-is so "fixed to the same city" below is a literal string
  // match with no new lookup needed).
  const fos = people
    .filter((p) => p.role === "fo" && p.active !== "false")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.person_id, name: p.name, city: hubName.get(p.hub) ?? p.hub }));

  const fromCityFilter = one(sp.fromCity);
  const fromId = one(sp.from);
  const fromPerson = fromId ? people.find((p) => p.person_id === fromId && p.role === "fo") : undefined;
  const fromCity = fromPerson ? (hubName.get(fromPerson.hub) ?? fromPerson.hub) : "";

  // ALL of that FO's current items (not just ones past 48h — a 0-48h item is still worth seeing and
  // moving, just not yet "overdue"). Oldest-held first; each row below flags 48h+ ones separately.
  const cutoff = Date.now() - HOURS_48;
  const overdueItems: OverdueItem[] | undefined = fromPerson
    ? items
        .filter((i) => i.current_holder === fromPerson.person_id && i.status === "with_fo" && i.updated_at)
        .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at))
        .map((i) => ({
          id: i.item_id,
          label: [ITEM_TYPE_LABELS[i.item_type as keyof typeof ITEM_TYPE_LABELS] ?? i.item_type, i.brand, i.model]
            .filter(Boolean)
            .join(" · "),
          since: formatIst(i.updated_at),
          hoursAgo: (Date.now() - Date.parse(i.updated_at)) / (60 * 60 * 1000),
          overdue: Date.parse(i.updated_at) <= cutoff,
        }))
    : undefined;

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <BackLink />
      </p>
      <h1>Transfer between FOs</h1>
      <p className={styles.hint}>
        Move an item that&apos;s already with one FO straight to a different FO. This happens
        immediately; the receiving FO doesn&apos;t need to confirm anything. A receipt is emailed to
        both FOs and to whoever records the transfer.
      </p>

      <div className={styles.field}>
        <label className={styles.label}>Logged in as</label>
        <div className={styles.control}>
          <p style={{ margin: 0, fontWeight: 600 }}>{loggedInAs}</p>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>From (field officer)</label>
        <div className={styles.control}>
          <FromFoPicker fos={fos} defaultCity={fromCityFilter} defaultFrom={fromId} />
          <p className={styles.hint}>
            {fromPerson
              ? `Showing ${fromPerson.name}'s items held 48+ hours with no hub submission, below.`
              : "Pick a city and FO to see their overdue items below — or skip this and type/scan item IDs directly."}
          </p>
        </div>
      </div>

      <form action={transferFoToFo} className={styles.form}>
        <FoToFoFields
          fos={fos}
          overdueItems={overdueItems}
          lockedCity={fromPerson ? fromCity : undefined}
          excludeId={fromPerson?.person_id}
        />

        <div className={styles.field}>
          <label className={styles.label} htmlFor="fonote">
            Notes *
          </label>
          <div className={styles.control}>
            <textarea id="fonote" name="note" rows={3} className={styles.textarea} required />
            <p className={styles.hint}>Required — say what this transfer is for.</p>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit">Transfer</button>
        </div>

        {one(sp.fdone) && (
          <p className={`${styles.ok} ${styles.result}`}>
            Moved {one(sp.fdone)} item(s) to {one(sp.fperson)}.
          </p>
        )}
        {one(sp.ferror) && <p className={`${styles.error} ${styles.result}`}>{one(sp.ferror)}</p>}
      </form>
    </main>
  );
}
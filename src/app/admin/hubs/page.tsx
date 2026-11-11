import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { wouldCreateCycle } from "@/lib/hub-tree";
import { getStore } from "@/lib/store";
import styles from "../admin.module.css";
import { addHub } from "./actions";
import HubRow from "./HubRow";
import BackLink from "../../BackLink";

const ERRORS: Record<string, string> = {
  invalid: "Please enter a valid name.",
  exists: "A hub with that name already exists.",
  loop: "A hub can't sit under itself or under one of its own sub-hubs.",
};

export default async function HubsPage({ searchParams }: PageProps<"/admin/hubs">) {
  await requireRole("admin");
  const sp = await searchParams;
  const error = one(sp.error);
  const hubs = (await getStore().list("hubs")).sort((a, b) => a.name.localeCompare(b.name));
  const central = hubs.find((h) => h.is_central === "true")?.hub_id ?? "";

  // For each hub, the parents it may take: every other hub except the ones under it.
  const parentOptions = (hubId?: string) =>
    hubs.filter((c) => c.hub_id !== hubId && (!hubId || !wouldCreateCycle(hubs, hubId, c.hub_id)));
  const parentSelect = (hubId: string | undefined, value: string) => (
    <select name="parent" defaultValue={value} aria-label="Parent hub">
      <option value="">Parent: none (top level)</option>
      {parentOptions(hubId).map((c) => (
        <option key={c.hub_id} value={c.hub_id}>
          Under: {c.name}
        </option>
      ))}
    </select>
  );

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <BackLink />
      </p>
      <h1>Hubs</h1>
      <p className={styles.muted}>
        {hubs.length} hubs. The parent decides where a hub sits on the dashboard tree. Deactivate a hub instead
        of deleting it so history stays intact. A hub that still holds items can&apos;t be deactivated.
      </p>
      {error === "hascards" ? (
        <p className={styles.error}>
          That hub still holds {one(sp.n) || "some"} item(s). Move or receive them first, then deactivate it.
        </p>
      ) : (
        ERRORS[error] && <p className={styles.error}>{ERRORS[error]}</p>
      )}

      <form action={addHub} className={styles.row} data-progress="1">
        <input name="name" placeholder="New hub name" required />
        <input name="city" placeholder="City (optional)" />
        {parentSelect(undefined, central)}
        <label>
          <input type="checkbox" name="is_central" /> Central
        </label>
        <button type="submit">Add hub</button>
      </form>

      <div className={styles.list}>
        {hubs.map((h) => (
          <HubRow key={h.hub_id} hub={h} parentOptions={parentOptions(h.hub_id)} />
        ))}
      </div>
    </main>
  );
}
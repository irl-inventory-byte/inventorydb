import Link from "next/link";
import {
  actorOptions,
  allowedActors,
  defaultActor,
} from "@/lib/actors";
import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { RECEIVE_ROLES, handoverStoreFor } from "@/lib/access";
import { STATUS_LABELS } from "@/lib/labels";
import type { Role, Status } from "@/lib/schema";
import styles from "../../admin/admin.module.css";
import { receiveCards } from "../actions";
import HubSelect from "./HubSelect";
import { mobileAliases } from "@/lib/scan";
import ReceiveScanArea from "./ReceiveScanArea";

export default async function ReceivePage({
  searchParams,
}: PageProps<"/handover/receive">) {
  const user = await requireRole(...RECEIVE_ROLES);
  const sp = await searchParams;
  const store = handoverStoreFor(user.role);

  const [items, hubs, people, users] = await Promise.all([
    store.list("items"),
    store.list("hubs"),
    store.list("people"),
    store.list("users"),
  ]);

  const activeHubs = hubs
    .filter((hub) => hub.active !== "false")
    .sort((a, b) => a.name.localeCompare(b.name));

  const hubNames = new Map(
    hubs.map((hub) => [hub.hub_id, hub.name])
  );

  // Existing permissions determine who may record the receipt.
  const byOptions = allowedActors(
    user,
    actorOptions(
      people,
      users,
      (id) => hubNames.get(id) ?? id,
      ["im", "rig", "qc", "hardware", "internal"]
    )
  );

  // QC team: receive the rigs sent to YOU. Hardware team: receive ANY rig sent to the hardware team.
  // No hub to choose.
  const HELD_FROM: Partial<Record<Role, Status>> = { qc: "pending_qc", hardware: "pending_hardware" };
  const heldFrom = HELD_FROM[user.role as Role];
  if (heldFrom) {
    const me = byOptions[0]?.value ?? "";
    const wholeTeam = user.role === "hardware";
    const waiting = items.filter((i) => i.status === heldFrom && (wholeTeam || i.current_holder === me));
    const personNames = new Map(people.map((p) => [p.person_id, p.name]));
    return (
      <main className={styles.page}>
        <p className={styles.back}>
          <Link href="/">← Home</Link>
        </p>
        <h1>Receive rigs</h1>
        <p className={styles.muted}>
          {wholeTeam
            ? "Rigs sent to the hardware team show here until someone receives them. Any hardware person can receive them, whoever they were sent to. Scan each rig you have in hand, then press Receive."
            : "Rigs sent to you show here until you receive them. Scan each rig you have in hand, then press Receive."}
        </p>

        <h2>
          {wholeTeam ? "Waiting for the hardware team" : "Waiting for you"} ({waiting.length})
        </h2>
        {waiting.length === 0 ? (
          <p className={styles.muted}>{wholeTeam ? "No rigs are waiting for the hardware team." : "No rigs are waiting for you."}</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Rig ID / Asset Tag</th>
                <th scope="col">Brand</th>
                <th scope="col">Model</th>
                <th scope="col">Hub</th>
                <th scope="col">Status</th>
                {wholeTeam && <th scope="col">Sent to</th>}
              </tr>
            </thead>
            <tbody>
              {waiting.map((i) => (
                <tr key={i.item_id}>
                  <td>
                    <Link href={`/inventory/${encodeURIComponent(i.item_id)}`}>{i.item_id}</Link>
                  </td>
                  <td>{i.brand || "—"}</td>
                  <td>{i.model || "—"}</td>
                  <td>{hubNames.get(i.current_hub) ?? i.current_hub}</td>
                  <td>{STATUS_LABELS[i.status] ?? i.status}</td>
                  {wholeTeam && <td>{personNames.get(i.current_holder) ?? (i.current_holder || "—")}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form action={receiveCards} className={styles.list} style={{ marginTop: 16 }}>
          <input type="hidden" name="hub" value="" />
          <ReceiveScanArea
            hub=""
            hubNames={Object.fromEntries(hubNames)}
            allowed={[heldFrom]}
            items={items.map((item) => ({
              id: item.item_id,
              status: item.status,
              hub: item.current_hub,
              type: item.item_type === "rig" || item.item_type === "mobile" ? item.item_type : "sd_card",
              ...(item.item_type === "mobile" && { aliases: mobileAliases(item.attributes) }),
            }))}
          />
          <div className={styles.row}>
            {byOptions.length ? (
              <span>
                Received by: <strong>{byOptions[0].label}</strong>
              </span>
            ) : (
              <span className={styles.error}>
                Your login is not linked to an active person in People. Ask an admin to link you.
              </span>
            )}
            <input name="note" placeholder="Note (optional)" aria-label="Note" />
            <button type="submit" disabled={!byOptions.length}>
              Receive rigs
            </button>
          </div>

          {one(sp.done) && (
            <p className={styles.ok} role="status">
              Received {one(sp.done)} rig(s). They are now with you.
            </p>
          )}
          {one(sp.error) && (
            <p className={styles.error} role="alert">
              {one(sp.error)}
            </p>
          )}
          <Link href="/handover/send">Send rigs instead →</Link>
        </form>
      </main>
    );
  }

  // Count items waiting to be received at each hub.
  const pendingByHub = new Map<string, number>();

  for (const item of items) {
    if (item.status === "pending") {
      pendingByHub.set(
        item.current_hub,
        (pendingByHub.get(item.current_hub) ?? 0) + 1
      );
    }
  }

  const busiest = [...pendingByHub.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  // Preserve the existing receiving-hub selection logic.
  const isActive = (id?: string) =>
    Boolean(id) &&
    activeHubs.some((hub) => hub.hub_id === id);

  const myHub = people.find(
    (person) => person.person_id === user.personId
  )?.hub;

  const requestedHub = one(sp.hub);

  const hub = isActive(requestedHub)
    ? requestedHub
    : isActive(myHub)
      ? myHub!
      : isActive(busiest)
        ? busiest!
        : (
            activeHubs.find(
              (candidate) => candidate.is_central === "true"
            )?.hub_id ??
            activeHubs[0]?.hub_id ??
            ""
          );

  const waitingElsewhere = [...pendingByHub.entries()]
    .filter(([id]) => id !== hub);

  const preferredActor = defaultActor(user);

  const selectedActor = byOptions.some(
    (option) => option.value === preferredActor
  )
    ? preferredActor
    : (byOptions[0]?.value ?? "");

  const canReceive = Boolean(hub) && byOptions.length > 0;

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <Link href="/">← Home</Link>
      </p>

      <h1>Receive items</h1>

      <p className={styles.muted}>
        Take items into stock at a hub: items sent to it, or
        items coming back from an IFO, FO or the rig team.
        Scan the QR codes into the box.
      </p>

      {/* Receiving hub selection. */}
      <form method="get" className={styles.row}>
        <HubSelect
          hubs={activeHubs.map((candidate) => ({
            id: candidate.hub_id,
            name: candidate.name,
          }))}
          value={hub}
        />

        <noscript>
          <button type="submit">Change hub</button>
        </noscript>
      </form>

      <p className={styles.muted}>
        Choose the hub first, then scan. Items sent to a hub
        can only be received there.
      </p>

      {!hub && (
        <p className={styles.error}>
          No active receiving hub is available. Ask an
          administrator to configure a hub.
        </p>
      )}

      {waitingElsewhere.length > 0 && (
        <p className={styles.muted}>
          Also waiting at other hubs:{" "}
          {waitingElsewhere.map(([id, count], index) => (
            <span key={id}>
              {index > 0 && ", "}

              <Link
                href={`/handover/receive?${new URLSearchParams({
                  hub: id,
                })}`}
              >
                {hubNames.get(id) ?? id} ({count})
              </Link>
            </span>
          ))}
        </p>
      )}

      <form action={receiveCards} className={styles.list}>
        <input type="hidden" name="hub" value={hub} />

        {/* Existing scan and batch-receipt interface. */}
        <ReceiveScanArea
          hub={hub}
          hubNames={Object.fromEntries(hubNames)}
          items={items.map((item) => ({
            id: item.item_id,
            status: item.status,
            hub: item.current_hub,
            type: item.item_type === "rig" || item.item_type === "mobile" ? item.item_type : "sd_card",
            ...(item.item_type === "mobile" && { aliases: mobileAliases(item.attributes) }),
          }))}
        />

        {/* Receive from has been removed.
            Received by remains to identify the recorder. */}
        <div className={styles.row}>
          {user.role === "admin" ? (
            <select
              name="by"
              defaultValue={selectedActor}
              aria-label="Received by"
              required
            >
              {byOptions.length === 0 && (
                <option value="">
                  No eligible recorder available
                </option>
              )}

              {byOptions.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                >
                  Received by: {option.label}
                </option>
              ))}
            </select>
          ) : byOptions.length ? (
            <span>
              Received by:{" "}
              <strong>{byOptions[0].label}</strong>
            </span>
          ) : (
            <span className={styles.error}>
              Your login is not linked to an active IM or rig
              team member. Ask an admin to link you.
            </span>
          )}

          <input
            name="expected"
            type="number"
            min="0"
            step="1"
            placeholder="Expected count (optional)"
            aria-label="Expected count"
          />

          <input
            name="note"
            placeholder="Note (optional)"
            aria-label="Note"
          />

          <button type="submit" disabled={!canReceive}>
            Receive items
          </button>
        </div>

        {one(sp.done) && (
          <p className={styles.ok} role="status">
            Received {one(sp.done)} item(s) into stock.
          </p>
        )}

        {one(sp.mismatch) && (
          <p className={styles.error} role="alert">
            {one(sp.mismatch)} It was recorded on each
            item&apos;s history.
          </p>
        )}

        {one(sp.error) && (
          <p className={styles.error} role="alert">
            {one(sp.error)}
          </p>
        )}

        <Link href="/handover/send">
          Send items instead →
        </Link>
      </form>
    </main>
  );
}
import Link from "next/link";
import { actorOptions, allowedActors, defaultActor } from "@/lib/actors";
import { requireRole } from "@/lib/authz";
import { STATUS_LABELS, one } from "@/lib/labels";
import type { QcCheck, Role, Status } from "@/lib/schema";
import { SEND_ROLES, canSeeType, storeFor } from "@/lib/access";
import styles from "../form.module.css";
import { sendCards } from "../actions";
import SendScanFields from "./SendScanFields";
import { rigCondition } from "@/lib/rig-state";
import { rigHomeHub } from "@/lib/rig-hub";
import HardwareSendFields from "./HardwareSendFields";
import QcSendFields from "./QcSendFields";
import SendToFields from "./SendToFields";
import { personHasRole, secondaryByPerson } from "@/lib/roles";
import { mobileAliases } from "@/lib/scan";

// The Send to list, grouped so it is easy to scan. What each group means is in the hint under the field.
const GROUP_LABELS: Record<string, string> = {
  im: "Inventory managers (IM)",
  ifo: "Couriers (IFO)",
  fo: "Field officers (FO)",
  rig: "Rig team",
  qc: "QC team",
  hardware: "Hardware team",
  internal: "Internal",
};

// Who each sender can send to. The full rig rules are checked on save (lib/handover.ts).
const SEND_TO: Record<string, Role[]> = {
  admin: ["im", "ifo", "fo", "rig", "qc", "hardware", "internal"],
  im: ["im", "ifo", "fo", "rig", "qc", "internal"],
  internal: ["im", "ifo", "fo", "rig", "qc", "internal"], // works like an IM
  rig: ["im", "ifo", "fo", "rig", "internal"],
  qc: ["im", "hardware", "qc"], // QC pass → IM, QC fail → hardware team, transfer → another QC person
  hardware: ["im", "hardware"], // repaired → IM, or a transfer to another hardware person (R&D and Dead: nobody)
};

// QC and hardware teams send the rigs they are holding.
const HELD: Partial<Record<Role, Status>> = { qc: "with_qc", hardware: "with_hardware" };

export default async function SendPage({ searchParams }: PageProps<"/handover/send">) {
  const user = await requireRole(...SEND_ROLES);
  const sp = await searchParams;
  const store = storeFor(user.role);
  const seesRigs = canSeeType(user.role, "rig");
  const [people, hubs, users, items, qcChecks] = await Promise.all([
    store.list("people"),
    store.list("hubs"),
    store.list("users"),
    store.list("items"),
    seesRigs ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
  ]);
  // Latest QC result per rig (rows are oldest first, so the last one wins).
  const latestQc = new Map<string, string>();
  for (const c of qcChecks) latestQc.set(c.item_id, c.qc_status);
  const held = HELD[user.role as Role];
  const scanItems = items.map((i) => ({
    id: i.item_id,
    status: i.status,
    hub: i.current_hub,
    type: i.item_type === "rig" || i.item_type === "mobile" ? i.item_type : "sd_card",
    // Mobiles can be scanned by IMEI, Asset Tag or Serial.
    ...(i.item_type === "mobile" && { aliases: mobileAliases(i.attributes) }),
    // Rigs show their condition while scanning, e.g. "QC passed · Idle" or "Repaired · Ready for field".
    ...(i.item_type === "rig" && { note: rigCondition(i.status, latestQc.get(i.item_id)).label }),
  }));
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const recipients = people.filter((p) => p.active !== "false").sort((a, b) => a.name.localeCompare(b.name));
  const byOptions = allowedActors(
    user,
    actorOptions(people, users, (id) => hubName.get(id) ?? id, ["im", "rig", "qc", "hardware", "internal"]),
  );
  const activeHubs = hubs.filter((h) => h.active !== "false").sort((a, b) => a.name.localeCompare(b.name));
  // QC and hardware teams always work at Bangalore.
  const bangaloreHub = rigHomeHub(hubs);
  const bangalore = bangaloreHub ? { id: bangaloreHub.hub_id, name: bangaloreHub.name } : undefined;

  // Start at the IM's own hub. Someone with no hub (an admin) starts where most cards are in stock.
  const stockByHub = new Map<string, number>();
  for (const i of items) if (i.status === "in_stock") stockByHub.set(i.current_hub, (stockByHub.get(i.current_hub) ?? 0) + 1);
  const fullest = [...stockByHub.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const isActive = (id?: string) => !!id && activeHubs.some((h) => h.hub_id === id);
  const myHub = people.find((p) => p.person_id === user.personId)?.hub;
  const defaultFromHub = isActive(myHub)
    ? myHub!
    : isActive(fullest)
      ? fullest!
      : (activeHubs.find((h) => h.is_central === "true")?.hub_id ?? activeHubs[0]?.hub_id ?? "");

  // A person shows under their People role AND under their login's secondary role (e.g. an IM who is also QC).
  const secondary = secondaryByPerson(users);
  // A person's city: the City of their hub, or the hub's name when City is blank (for the FO city filter).
  const hubCityOf = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));
  // Categories with the people in each, for the two-step picker. Empty categories are left out.
  const personGroups = (SEND_TO[user.role] ?? []).map((role) => ({
    role,
    label: GROUP_LABELS[role] ?? role,
    people: recipients
      .filter((p) => personHasRole(p, role, secondary))
      // A QC or hardware person transfers to ANOTHER person of their team, never to themselves.
      .filter((p) => !((user.role === "qc" || user.role === "hardware") && role === user.role && p.person_id === user.personId))
      .map((p) => ({
        id: p.person_id,
        label: `${p.name} (${hubName.get(p.hub) ?? p.hub})${p.linked_user ? ` — ${p.linked_user}` : ""}`,
        city: hubCityOf.get(p.hub) ?? "",
      })),
  })).filter((g) => g.people.length > 0);

  const toPerson = people.find((p) => p.person_id === one(sp.person))?.name ?? one(sp.person);
  const toHubName = hubName.get(one(sp.hub)) ?? one(sp.hub);
  const status = STATUS_LABELS[one(sp.status) as Status] ?? one(sp.status);

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <Link href="/">← Home</Link>
      </p>
      <h1>Send items</h1>

      <form action={sendCards} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="by">
            Sent by
          </label>
          <div className={styles.control}>
            {user.role === "admin" ? (
              <>
                <select id="by" name="by" defaultValue={defaultActor(user)} required>
                  {byOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className={styles.hint}>
                  As an admin you can send on behalf of anyone. Your own sign-in is always saved on the record too.
                </p>
              </>
            ) : byOptions.length ? (
              <>
                <strong id="by">{byOptions[0].label}</strong>
                <p className={styles.hint}>Handovers are recorded under your name.</p>
              </>
            ) : (
              <p className={styles.error}>
                Your login is not linked to an active person in People, so you can&apos;t send yet. Ask an admin to link you on the Users screen.
              </p>
            )}
          </div>
        </div>

        <SendScanFields
          hubs={activeHubs.map((h) => ({ id: h.hub_id, name: h.name }))}
          defaultHub={defaultFromHub}
          items={scanItems}
          held={held}
        />

        {user.role === "qc" ? (
          <QcSendFields groups={personGroups} hubs={activeHubs.map((h) => ({ id: h.hub_id, name: h.name }))} bangalore={bangalore} />
        ) : user.role === "hardware" ? (
          <HardwareSendFields groups={personGroups} hubs={activeHubs.map((h) => ({ id: h.hub_id, name: h.name }))} bangalore={bangalore} />
        ) : (
          <SendToFields
            groups={personGroups}
            hubs={activeHubs.map((h) => ({ id: h.hub_id, name: h.name }))}
            allowInternal={!held}
            bangalore={bangalore}
            alwaysBangalore={false}
          />
        )}

        {seesRigs && user.role !== "qc" && (
          <p className={styles.hint}>
            {user.role === "hardware"
              ? "Rigs: Repaired → an IM (it is then Ready for field). Send to hardware → another hardware person. R&D or Dead → the rig leaves service."
              : "Rigs: QC passed or repaired → FO or IFO. QC pending or failed → QC team only."}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="note">
            Notes
          </label>
          <div className={styles.control}>
            <textarea id="note" name="note" rows={3} className={styles.textarea} />
            <p className={styles.hint}>The checkout date and time are recorded automatically when you press Send.</p>
          </div>
        </div>

        <div className={styles.actions}>
          <button type="submit">Send items</button>
          <Link href="/handover/receive">Receive items instead →</Link>
        </div>

        {one(sp.done) && one(sp.outcome) && (
          <p className={`${styles.ok} ${styles.result}`}>
            Marked {one(sp.done)} rig(s) as {one(sp.outcome) === "dead" ? "Dead / Retired" : "R&D"}.
          </p>
        )}
        {one(sp.done) && !one(sp.outcome) && (
          <p className={`${styles.ok} ${styles.result}`}>
            Sent {one(sp.done)} item(s) to {toPerson} at {toHubName}. Status: {status}.{" "}
            {one(sp.batch) && <Link href={`/handover/receipt/${one(sp.batch)}`}>View / print receipt →</Link>}
          </p>
        )}
        {one(sp.error) && <p className={`${styles.error} ${styles.result}`}>{one(sp.error)}</p>}
      </form>
    </main>
  );
}
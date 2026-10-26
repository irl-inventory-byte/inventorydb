import { ROLE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { ROLES, STATUSES, type Hub, type Person } from "@/lib/schema";
import styles from "../admin/admin.module.css";
import HolderPicker from "./HolderPicker";

// Form fields for correcting cards. The parent page supplies the <form> and the card ids.
export default function CorrectionPanel({
  hubs,
  people,
  showScan,
}: {
  hubs: Hub[];
  people: Person[];
  showScan: boolean;
}) {
  const activeHubs = hubs.filter((h) => h.active !== "false").sort((a, b) => a.name.localeCompare(b.name));
  const activePeople = people.filter((p) => p.active !== "false").sort((a, b) => a.name.localeCompare(b.name));
  // Roles that have at least one active person, in the usual order (IM, IFO, FO, …).
  const roles = ROLES.filter((r) => activePeople.some((p) => p.role === r)).map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  return (
    <fieldset className={styles.details}>
      <legend>Correct status / location</legend>
      <p className={styles.muted}>
        Sets where the selected items really are. It is recorded as a correction with your name and the
        note. Holder is used for Pending, Traveling, With FO and With rig team only. Choose the Role first to
        list only people with that role.
      </p>
      {showScan && (
        <textarea
          name="scanned"
          rows={3}
          placeholder="Or scan / paste here, one per line: serial, rig ID, or a mobile's IMEI, Asset Tag or Serial"
          className={styles.textarea}
        />
      )}
      <div className={styles.row}>
        <select name="status" defaultValue="" required>
          <option value="" disabled>
            New status
          </option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select name="hub" defaultValue="">
          <option value="">Current hub: keep</option>
          {activeHubs.map((h) => (
            <option key={h.hub_id} value={h.hub_id}>
              {h.name}
            </option>
          ))}
        </select>
        <HolderPicker
          people={activePeople.map((p) => ({ id: p.person_id, name: p.name, role: p.role, roleLabel: ROLE_LABELS[p.role] ?? p.role }))}
          roles={roles}
        />
        <select name="homeHub" defaultValue="">
          <option value="">Home hub: keep</option>
          {activeHubs.map((h) => (
            <option key={h.hub_id} value={h.hub_id}>
              Home: {h.name}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.row}>
        <input name="note" placeholder="Note (required), e.g. found with FO in Kadapa" required />
        <button type="submit">Apply correction</button>
      </div>
    </fieldset>
  );
}

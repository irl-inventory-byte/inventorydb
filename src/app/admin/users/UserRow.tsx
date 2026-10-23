"use client";

import { useRef } from "react";
import { ROLE_LABELS } from "@/lib/labels";
import type { AppUser, Person } from "@/lib/schema";
import styles from "../admin.module.css";
import { saveUser } from "./actions";

/** Every field applies immediately: selects and the checkbox submit on change. No Save button. */
export default function UserRow({
  user,
  linkable,
  isMe,
  back = "",
}: {
  user: AppUser;
  linkable: Person[];
  isMe: boolean;
  back?: string; // the page's filters, kept after saving
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submit = () => formRef.current?.requestSubmit();

  return (
    <form ref={formRef} action={saveUser} className={styles.row}>
      <input type="hidden" name="email" value={user.email} />
      <input type="hidden" name="back" value={back} />
      {/* Your own row: primary role and Active can't be changed (they are sent as they are). */}
      {isMe && <input type="hidden" name="role" value={user.role} />}
      {isMe && <input type="hidden" name="active" value="on" />}
      <span style={{ flex: "1 1 220px" }}>
        {user.email}
        {isMe && " (you)"}
      </span>
      <select
        name={isMe ? undefined : "role"}
        defaultValue={user.role}
        onChange={submit}
        disabled={isMe}
        aria-label="Primary role"
        title={isMe ? "Your own primary role can't be changed. Ask another admin." : "Primary role (required)"}
      >
        <option value="im">IM</option>
        <option value="rig">Rig</option>
        <option value="fo">FO</option>
        <option value="hardware">Hardware team</option>
        <option value="qc">QC team</option>
        <option value="internal">Internal team</option>
        <option value="admin">Admin</option>
      </select>
      <select
        name="secondary"
        defaultValue={user.secondary_role ?? ""}
        onChange={submit}
        aria-label="Secondary role"
        title="Secondary role (optional): the person can switch to it"
      >
        <option value="">Secondary role: none</option>
        <option value="im">Secondary: IM</option>
        <option value="rig">Secondary: Rig</option>
        <option value="fo">Secondary: FO</option>
        <option value="hardware">Secondary: Hardware team</option>
        <option value="qc">Secondary: QC team</option>
        <option value="internal">Secondary: Internal team</option>
        {!isMe && <option value="admin">Secondary: Admin</option>}
      </select>
      <select name="person" defaultValue={user.person_id} onChange={submit}>
        <option value="">Linked person: none</option>
        {linkable.map((p) => (
          <option key={p.person_id} value={p.person_id}>
            {p.name} ({ROLE_LABELS[p.role]})
          </option>
        ))}
      </select>
      <label>
        <input type="checkbox" name={isMe ? undefined : "active"} defaultChecked={user.active !== "false"} disabled={isMe} onChange={submit} /> Active
      </label>
    </form>
  );
}
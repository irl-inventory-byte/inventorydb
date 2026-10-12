import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { ROLE_LABELS } from "@/lib/labels";
import { getStore } from "@/lib/store";
import styles from "../admin.module.css";
import { addUser } from "./actions";
import UserRow from "./UserRow";

const ERRORS: Record<string, string> = {
  invalid: "Please enter a valid email and role.",
  exists: "That email already has access.",
  person: "An IM login must be linked to an active IM, and a Rig login to an active rig team member, from the People tab. FO, Hardware and QC logins may only be linked to a person of the same role.",
  self: "You can't change your own access. Ask another admin.",
};

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const me = await requireRole("admin");
  const { error } = await searchParams;
  const store = getStore();
  const [users, people] = await Promise.all([store.list("users"), store.list("people")]);
  users.sort((a, b) => a.email.localeCompare(b.email));
  // Logins link to an IM or a rig team member; the server checks the role matches the login's role.
  const linkable = people
    .filter((p) => ["im", "rig", "fo", "hardware", "qc"].includes(p.role) && p.active !== "false")
    .sort((a, b) => a.name.localeCompare(b.name));

  const roleSelect = (value?: string) => (
    <select name="role" defaultValue={value ?? "im"}>
      <option value="im">IM</option>
      <option value="rig">Rig</option>
      <option value="fo">FO</option>
      <option value="hardware">Hardware team</option>
      <option value="qc">QC team</option>
      <option value="admin">Admin</option>
    </select>
  );
  const personSelect = (value?: string) => (
    <select name="person" defaultValue={value ?? ""}>
      <option value="">Linked person: none</option>
      {linkable.map((p) => (
        <option key={p.person_id} value={p.person_id}>
          {p.name} ({ROLE_LABELS[p.role]})
        </option>
      ))}
    </select>
  );

  return (
    <main className={styles.page}>
      <p className={styles.back}>
        <Link href="/">← Home</Link>
      </p>
      <h1>Users</h1>
      <p className={styles.muted}>
        Only these Google accounts can sign in. Admins and IMs can send and receive items. Rig can view the
        dashboard and inventory. IM and Rig logins must be linked to their entry in the People tab. Changes
        apply the next time that person signs in. Deactivate instead of deleting.
      </p>
      {typeof error === "string" && ERRORS[error] && <p className={styles.error}>{ERRORS[error]}</p>}

      <form action={addUser} className={styles.row}>
        <input name="email" type="email" placeholder="Google email" required />
        {roleSelect()}
        {personSelect()}
        <button type="submit">Add user</button>
      </form>

      <div className={styles.list}>
        {users.map((u) => (
          <UserRow key={u.email} user={u} linkable={linkable} isMe={u.email.toLowerCase() === me.email?.toLowerCase()} />
        ))}
      </div>
    </main>
  );
}
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
  same: "The secondary role must be different from the primary role.",
  secondaryperson:
    "A secondary role of IM, QC, Hardware, Rig, FO or Internal needs a linked person (handovers are recorded under that person). Choose the linked person first.",
};

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const me = await requireRole("admin");
  const { error, q, frole, fstatus } = await searchParams;
  const text = typeof q === "string" ? q.trim().toLowerCase() : "";
  const roleFilter = typeof frole === "string" ? frole : "";
  const statusFilter = typeof fstatus === "string" ? fstatus : "";
  const store = getStore();
  const [users, people] = await Promise.all([store.list("users"), store.list("people")]);
  users.sort((a, b) => a.email.localeCompare(b.email));
  // Logins link to an IM or a rig team member; the server checks the role matches the login's role.
  const linkable = people
    .filter((p) => ["im", "rig", "fo", "hardware", "qc", "internal"].includes(p.role) && p.active !== "false")
    .sort((a, b) => a.name.localeCompare(b.name));

  // Filter: search (email or linked person), role (primary or secondary), active / inactive.
  const nameOf = new Map(people.map((p) => [p.person_id, p.name]));
  const shown = users.filter((u) => {
    const active = u.active !== "false";
    if (statusFilter === "active" && !active) return false;
    if (statusFilter === "inactive" && active) return false;
    if (roleFilter === "two" && !u.secondary_role) return false;
    if (roleFilter && roleFilter !== "two" && u.role !== roleFilter && u.secondary_role !== roleFilter) return false;
    if (text && !`${u.email} ${nameOf.get(u.person_id) ?? ""}`.toLowerCase().includes(text)) return false;
    return true;
  });
  const filtered = !!(text || roleFilter || statusFilter);

  const roleSelect = (value?: string) => (
    <select name="role" defaultValue={value ?? "im"}>
      <option value="im">IM</option>
      <option value="rig">Rig</option>
      <option value="fo">FO</option>
      <option value="hardware">Hardware team</option>
      <option value="qc">QC team</option>
      <option value="internal">Internal team</option>
      <option value="admin">Admin</option>
    </select>
  );
  const secondarySelect = () => (
    <select name="secondary" defaultValue="" aria-label="Secondary role">
      <option value="">Secondary role: none</option>
      <option value="im">Secondary: IM</option>
      <option value="rig">Secondary: Rig</option>
      <option value="fo">Secondary: FO</option>
      <option value="hardware">Secondary: Hardware team</option>
      <option value="qc">Secondary: QC team</option>
      <option value="internal">Secondary: Internal team</option>
      <option value="admin">Secondary: Admin</option>
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
      <p className={styles.muted}>
        <strong>Primary role</strong> is required. <strong>Secondary role</strong> is optional: give it only to
        people who do two jobs (e.g. Admin + QC, or IM + QC). They can then switch between the two roles from Home
        or the Dashboard. A secondary role of IM, QC, Hardware, Rig, FO or Internal needs a linked person. Only
        admins can set it.
      </p>
      {typeof error === "string" && ERRORS[error] && <p className={styles.error}>{ERRORS[error]}</p>}

      <form action={addUser} className={styles.row}>
        <input name="email" type="email" placeholder="Google email" required />
        {roleSelect()}
        {secondarySelect()}
        {personSelect()}
        <button type="submit">Add user</button>
      </form>

      <h2 style={{ marginTop: 24 }}>Find a user</h2>
      <form method="get" action="/admin/users" className={styles.row}>
        <input name="q" type="text" defaultValue={text} placeholder="Search email or name" aria-label="Search email or name" />
        <select name="frole" defaultValue={roleFilter} aria-label="Role">
          <option value="">All roles</option>
          <option value="im">IM</option>
          <option value="rig">Rig</option>
          <option value="fo">FO</option>
          <option value="hardware">Hardware team</option>
          <option value="qc">QC team</option>
          <option value="internal">Internal team</option>
          <option value="admin">Admin</option>
          <option value="two">Has a secondary role</option>
        </select>
        <select name="fstatus" defaultValue={statusFilter} aria-label="Status">
          <option value="">Active and inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <button type="submit">Filter</button>
        {filtered && <Link href="/admin/users">Clear filter</Link>}
      </form>
      <p className={styles.muted}>
        Showing {shown.length} of {users.length} users. A role matches the primary or the secondary role.
      </p>

      <div className={styles.list}>
        {shown.length === 0 && <p className={styles.muted}>No users match this filter.</p>}
        {shown.map((u) => (
          <UserRow key={u.email} user={u} linkable={linkable} isMe={u.email.toLowerCase() === me.email?.toLowerCase()} />
        ))}
      </div>
    </main>
  );
}
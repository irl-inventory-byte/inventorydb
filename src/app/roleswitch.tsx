import { ROLE_LABELS } from "@/lib/labels";
import type { Role } from "@/lib/schema";
import { switchRole } from "./roleactions";

/**
 * "Acting as: Admin · Switch to QC team". Shown only to logins that have a secondary role.
 * `back` is the page to return to after switching.
 */
export default function RoleSwitch({
  role,
  primaryRole,
  secondaryRole,
  back = "/",
}: {
  role: Role;
  primaryRole: Role;
  secondaryRole?: Role;
  back?: string;
}) {
  if (!secondaryRole || secondaryRole === primaryRole) return null;
  const other = role === secondaryRole ? primaryRole : secondaryRole;
  return (
    <form
      action={switchRole}
      style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: "0.9rem" }}
    >
      <input type="hidden" name="role" value={other} />
      <input type="hidden" name="back" value={back} />
      <span>
        Acting as <strong>{ROLE_LABELS[role]}</strong>
        {role === secondaryRole ? " (secondary)" : " (primary)"}
      </span>
      <button
        type="submit"
        style={{
          padding: "6px 12px",
          borderRadius: 999,
          border: "1px solid #1e293b",
          background: "#1e293b",
          color: "#ffffff",
          font: "inherit",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Switch to {ROLE_LABELS[other]}
      </button>
    </form>
  );
}
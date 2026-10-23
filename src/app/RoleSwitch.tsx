import { ROLE_LABELS } from "@/lib/labels";
import type { Role } from "@/lib/schema";
import { switchRole } from "./role-actions";

/**
 * Primary / secondary role switch, shown in the top bar next to the user's name: two buttons side by side,
 * e.g. [ Admin | QC team ]. The role in use is filled in; clicking the other one switches to it.
 * Shown only to logins that have a secondary role. `back` is the page to return to after switching.
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
  const options: { value: Role; hint: string }[] = [
    { value: primaryRole, hint: "Primary role" },
    { value: secondaryRole, hint: "Secondary role" },
  ];
  return (
    <form
      action={switchRole}
      aria-label="Switch role"
      title="You have two roles. Click the other one to switch."
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0,
        padding: 3,
        borderRadius: 999,
        border: "1px solid #2563eb",
        background: "#ffffff",
        boxShadow: "0 1px 2px rgba(15, 23, 42, 0.12)",
        fontSize: "0.85rem",
        whiteSpace: "nowrap",
      }}
    >
      <input type="hidden" name="back" value={back} />
      {options.map((o) => {
        const on = o.value === role;
        return (
          <button
            key={o.value}
            type="submit"
            name="role"
            value={o.value}
            disabled={on}
            aria-pressed={on}
            title={on ? `${o.hint}: in use now` : `${o.hint}: click to switch`}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "none",
              background: on ? "#2563eb" : "#ffffff",
              color: on ? "#ffffff" : "#1e3a8a",
              font: "inherit",
              fontWeight: on ? 700 : 600,
              cursor: on ? "default" : "pointer",
              opacity: 1,
            }}
          >
            {ROLE_LABELS[o.value]}
          </button>
        );
      })}
    </form>
  );
}
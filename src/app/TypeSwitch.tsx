import Link from "next/link";
import { allowedTypes, type ItemType } from "@/lib/access";
import { ITEM_TYPE_LABELS } from "@/lib/labels";
import type { Role } from "@/lib/schema";

/**
 * "All · SD cards · Rigs · Mobile" switch. Only shown to logins that can see more
 * than one item type. Keeps the other filters in the address bar.
 */
export default function TypeSwitch({
  role,
  current,
  path,
  params = {},
  includeAll = true,
  only,
}: {
  role: Role;
  current: ItemType | "";
  path: string;
  params?: Record<string, string>;
  /** false: no "All items" choice (the dashboard always shows one type). */
  includeAll?: boolean;
  /** Show only these types (e.g. Analytics has no Mobile choice). */
  only?: readonly ItemType[];
}) {
  const types = allowedTypes(role).filter((t) => !only || only.includes(t));
  if (types.length < 2) return null;

  const href = (type: string) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([k, v]) => v && k !== "type" && k !== "page")
    );
    if (type) q.set("type", type);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };

  const options: [string, string][] = [
    ...(includeAll ? [["", "All items"] as [string, string]] : []),
    ...types.map((t) => [t, ITEM_TYPE_LABELS[t] ?? t] as [string, string]),
  ];

  return (
    <nav
      aria-label="Item type"
      style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 16px" }}
    >
      {options.map(([value, label]) => {
        const active = value === current;
        return (
          <Link
            key={value || "all"}
            href={href(value)}
            aria-current={active ? "page" : undefined}
            style={{
              padding: "8px 16px",
              minHeight: 40,
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 999,
              border: "1px solid currentColor",
              textDecoration: "none",
              fontWeight: active ? 700 : 400,
              opacity: active ? 1 : 0.7,
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
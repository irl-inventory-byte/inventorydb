"use client";

import Link from "next/link";
import styles from "./dashboard.module.css";

/**
 * City and Role filter for the "Needs attention" table on the Dashboard.
 * Choosing an option reloads the page with ?acity=…&arole=… and jumps back to the table.
 * Other dashboard settings (SD cards / Rigs switch, empty hubs) are kept.
 */
export default function AttentionFilter({
  cities,
  roles,
  city,
  role,
  keep,
}: {
  cities: string[];
  roles: string[];
  city: string;
  role: string;
  keep: Record<string, string>;
}) {
  const clearHref = `/dashboard?${new URLSearchParams(keep)}#attention`;
  const selectStyle = { padding: "6px 10px", border: "1px solid #c9c9c9", borderRadius: 6, font: "inherit", minWidth: 150 };

  return (
    <form
      method="get"
      action="/dashboard#attention"
      style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", margin: "4px 0 10px" }}
    >
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span>City</span>
        <select name="acity" defaultValue={city} onChange={(e) => e.currentTarget.form?.requestSubmit()} style={selectStyle}>
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span>Role</span>
        <select name="arole" defaultValue={role} onChange={(e) => e.currentTarget.form?.requestSubmit()} style={selectStyle}>
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <noscript>
        <button type="submit">Filter</button>
      </noscript>
      {(city || role) && (
        <Link href={clearHref} className={styles.link}>
          Clear filter
        </Link>
      )}
    </form>
  );
}
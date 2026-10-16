"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./dashboard.module.css";

/**
 * City and Role filters for the "Needs attention" table on the Dashboard. Each is a dropdown with tick
 * boxes, so several cities or roles can be chosen at once. Apply reloads the page with
 * ?acity=Bangalore,Pune&arole=FO,IFO and jumps back to the table. Other dashboard settings
 * (SD cards / Rigs switch, empty hubs) are kept.
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
  city: string[]; // chosen cities, empty = all
  role: string[]; // chosen roles, empty = all
  keep: Record<string, string>;
}) {
  const [pickedCities, setPickedCities] = useState<string[]>(city);
  const [pickedRoles, setPickedRoles] = useState<string[]>(role);
  const formRef = useRef<HTMLFormElement>(null);
  const clearHref = `/dashboard?${new URLSearchParams(keep)}#attention`;
  const changed =
    pickedCities.join(",") !== city.join(",") || pickedRoles.join(",") !== role.join(",");

  return (
    <form
      ref={formRef}
      method="get"
      action="/dashboard#attention"
      style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", margin: "4px 0 12px" }}
    >
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {pickedCities.length > 0 && <input type="hidden" name="acity" value={pickedCities.join(",")} />}
      {pickedRoles.length > 0 && <input type="hidden" name="arole" value={pickedRoles.join(",")} />}

      <MultiPick label="City" allText="All cities" plural="cities" options={cities} picked={pickedCities} onChange={setPickedCities} />
      <MultiPick label="Role" allText="All roles" plural="roles" options={roles} picked={pickedRoles} onChange={setPickedRoles} />

      <button
        type="submit"
        disabled={!changed}
        style={{
          padding: "8px 18px",
          borderRadius: 8,
          border: "1px solid #1e293b",
          background: changed ? "#1e293b" : "#e5e7eb",
          color: changed ? "#ffffff" : "#6b7280",
          font: "inherit",
          fontWeight: 600,
          cursor: changed ? "pointer" : "default",
        }}
      >
        Apply
      </button>
      {(city.length > 0 || role.length > 0) && (
        <Link href={clearHref} className={styles.link}>
          Clear filter
        </Link>
      )}
    </form>
  );
}

/** A button that opens a list of tick boxes. Nothing ticked = everything. */
function MultiPick({
  label,
  allText,
  plural,
  options,
  picked,
  onChange,
}: {
  label: string;
  allText: string;
  plural: string;
  options: string[];
  picked: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (value: string) =>
    onChange(picked.includes(value) ? picked.filter((p) => p !== value) : [...picked, value].sort((a, b) => a.localeCompare(b)));

  const summary =
    picked.length === 0 ? allText : picked.length <= 2 ? picked.join(", ") : `${picked.length} ${plural}`;

  return (
    <div ref={boxRef} style={{ position: "relative", display: "flex", gap: 6, alignItems: "center" }}>
      <span>{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          minWidth: 170,
          maxWidth: 260,
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          padding: "8px 12px",
          border: "1px solid #c9c9c9",
          borderRadius: 8,
          background: "#ffffff",
          font: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <span aria-hidden>▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label={label}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 20,
            minWidth: 240,
            maxHeight: 320,
            overflowY: "auto",
            background: "#ffffff",
            border: "1px solid #d1d5db",
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.15)",
            padding: 8,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 8px 8px", borderBottom: "1px solid #eee" }}>
            <button type="button" onClick={() => onChange([...options])} style={linkButton}>
              Select all
            </button>
            <button type="button" onClick={() => onChange([])} style={linkButton}>
              Clear
            </button>
          </div>
          {options.length === 0 && <p style={{ margin: 8, color: "#6b7280" }}>Nothing to choose.</p>}
          {options.map((o) => (
            <label
              key={o}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 8px", borderRadius: 6, cursor: "pointer" }}
            >
              <input type="checkbox" checked={picked.includes(o)} onChange={() => toggle(o)} style={{ width: 16, height: 16 }} />
              <span>{o}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const linkButton = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#1d4ed8",
  font: "inherit",
  fontSize: "0.9rem",
  cursor: "pointer",
  textDecoration: "underline",
} as const;
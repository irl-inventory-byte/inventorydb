"use client";

import { useMemo, useState } from "react";

export interface FoOption {
  id: string;
  name: string;
  roleRaw: "fo" | "ifo";
  roleLabel: string;
  hub: string;
  city: string; // lower-cased, matches cityOptions' value
}

/**
 * Role (FO / IFO) + City + Name, as one client component so picking a role or city narrows the Name
 * dropdown instantly — no page reload, no separate Search click needed just to see the right names.
 * The actual asset lookup for whichever person gets chosen still happens on Search/page load (see
 * fo-assets/page.tsx); this only makes the dropdowns feel connected to each other.
 */
export default function FoNamePicker({
  fos,
  cityOptions,
  defaultRole,
  defaultCity,
  defaultFo,
}: {
  fos: FoOption[];
  cityOptions: { value: string; label: string }[];
  defaultRole: string;
  defaultCity: string;
  defaultFo: string;
}) {
  const [role, setRole] = useState(defaultRole);
  const [city, setCity] = useState(defaultCity);
  const [fo, setFo] = useState(defaultFo);

  const filtered = useMemo(
    () => fos.filter((p) => (!role || p.roleRaw === role) && (!city || p.city === city)),
    [fos, role, city],
  );

  // If switching role/city drops the previously chosen person out of the list, don't keep submitting
  // their (now hidden) id — show "Choose…" instead, same as if nothing had been picked yet.
  const foValue = filtered.some((p) => p.id === fo) ? fo : "";

  return (
    <>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <strong style={{ fontWeight: 600 }}>Role</strong>
        <select
          name="role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setFo("");
          }}
          aria-label="Role"
        >
          <option value="">All FO/IFO</option>
          <option value="fo">FO</option>
          <option value="ifo">IFO</option>
        </select>
      </label>

      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <strong style={{ fontWeight: 600 }}>City</strong>
        <select
          name="city"
          value={city}
          onChange={(e) => {
            setCity(e.target.value);
            setFo("");
          }}
          aria-label="City"
        >
          <option value="">All cities</option>
          {cityOptions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <strong style={{ fontWeight: 600 }}>FO name</strong>
        <select name="fo" value={foValue} onChange={(e) => setFo(e.target.value)} aria-label="FO / IFO name">
          <option value="">Choose…</option>
          {filtered.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.roleLabel}, {p.hub})
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
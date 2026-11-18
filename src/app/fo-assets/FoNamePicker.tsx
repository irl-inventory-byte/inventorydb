"use client";

import { useMemo, useState } from "react";

export interface FoOption {
  id: string;
  name: string;
  role: string;
  hub: string;
  city: string; // lower-cased, matches cityOptions' value
}

/**
 * City + FO name, as one client component so picking a city narrows the Name dropdown instantly —
 * no page reload, no separate Search click needed just to see the right names. The actual asset
 * lookup for whichever FO gets chosen still happens on Search/page load (see fo-assets/page.tsx);
 * this only makes the two dropdowns feel connected.
 */
export default function FoNamePicker({
  fos,
  cityOptions,
  defaultCity,
  defaultFo,
}: {
  fos: FoOption[];
  cityOptions: { value: string; label: string }[];
  defaultCity: string;
  defaultFo: string;
}) {
  const [city, setCity] = useState(defaultCity);
  const [fo, setFo] = useState(defaultFo);

  const filtered = useMemo(() => fos.filter((p) => !city || p.city === city), [fos, city]);

  // If switching city drops the previously chosen FO out of the list, don't keep submitting their
  // (now hidden) id — show "Choose…" instead, same as if nothing had been picked yet.
  const foValue = filtered.some((p) => p.id === fo) ? fo : "";

  return (
    <>
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
              {p.name} ({p.role}, {p.hub})
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
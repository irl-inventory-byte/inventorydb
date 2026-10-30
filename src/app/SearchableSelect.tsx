"use client";

import { useState, type CSSProperties } from "react";

/**
 * A single-choice <select> (submits one value, like a normal GET filter) with a type-to-search box
 * above it that narrows the list by name. For a list of people long enough that scrolling a plain
 * dropdown is slow.
 */
export default function SearchableSelect({
  name,
  ariaLabel,
  allLabel,
  options,
  defaultValue,
  style,
}: {
  name: string;
  ariaLabel: string;
  allLabel: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  style?: CSSProperties;
}) {
  const [query, setQuery] = useState("");
  const [value, setValue] = useState(defaultValue ?? "");
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  // Keep the chosen option selectable even if a later search hides it from the visible list.
  const chosen = options.find((o) => o.value === value);
  const list = chosen && !shown.some((o) => o.value === value) ? [chosen, ...shown] : shown;

  return (
    <span style={{ display: "inline-flex", gap: 4, ...style }}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${ariaLabel.toLowerCase()}…`}
        aria-label={`Search ${ariaLabel}`}
        style={{ width: 120, padding: "6px 8px", border: "1px solid #b5b5b5", borderRadius: 6, font: "inherit" }}
      />
      <select name={name} aria-label={ariaLabel} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">{allLabel}</option>
        {list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

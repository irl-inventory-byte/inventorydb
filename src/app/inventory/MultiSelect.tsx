"use client";

import { useMemo, useState } from "react";

/**
 * A dropdown of checkboxes for a GET filter form: tick several options and
 * press Filter. Works without JavaScript (a native <details> element), and
 * each ticked box is sent as its own value, e.g. ?status=in_stock&status=with_fo.
 *
 * `searchable`: adds a type-to-filter box above the list, for long lists (e.g. everyone's name).
 * Typing narrows which options are shown; already-ticked boxes stay ticked even while hidden.
 */
export default function MultiSelect({
  name,
  label,
  allLabel,
  options,
  selected,
  searchable = false,
}: {
  name: string;
  label: string;
  allLabel: string;
  options: { value: string; label: string }[];
  selected: string[];
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");

  const chosen = options.filter((o) => selected.includes(o.value));
  const summary =
    chosen.length === 0
      ? allLabel
      : chosen.length <= 2
        ? chosen.map((o) => o.label).join(", ")
        : `${chosen.length} selected`;

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options),
    [options, q],
  );

  return (
    <details style={{ position: "relative" }}>
      <summary
        aria-label={`${label}: ${summary}`}
        style={{
          listStyle: "none",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          minHeight: 36,
          padding: "6px 12px",
          border: "1px solid #b5b5b5",
          borderRadius: 6,
          background: chosen.length ? "#EEF2FF" : "#fff",
          color: "#1a1a1a",
          whiteSpace: "nowrap",
          maxWidth: 260,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <strong style={{ fontWeight: 600 }}>{label}:</strong> {summary}
        <span aria-hidden="true" style={{ fontSize: 10, marginLeft: 2 }}>
          ▼
        </span>
      </summary>

      <div
        role="group"
        aria-label={label}
        style={{
          position: "absolute",
          zIndex: 20,
          top: "calc(100% + 4px)",
          left: 0,
          minWidth: 240,
          maxHeight: 360,
          overflowY: "auto",
          padding: 8,
          background: "#fff",
          color: "#1a1a1a",
          border: "1px solid #b5b5b5",
          borderRadius: 8,
          boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {searchable && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            aria-label={`Search ${label}`}
            style={{
              position: "sticky",
              top: 0,
              marginBottom: 6,
              padding: "6px 8px",
              border: "1px solid #b5b5b5",
              borderRadius: 6,
              font: "inherit",
              background: "#fff",
              color: "#1a1a1a",
            }}
          />
        )}

        {/* Ticked options stay in the form even while a search hides them from view. */}
        {searchable &&
          chosen
            .filter((o) => !shown.includes(o))
            .map((o) => <input key={o.value} type="checkbox" name={name} value={o.value} defaultChecked hidden readOnly />)}

        {shown.map((o) => (
          <label
            key={o.value}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minHeight: 32,
              padding: "4px 6px",
              borderRadius: 4,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={selected.includes(o.value)}
            />
            {o.label}
          </label>
        ))}
        {shown.length === 0 && (
          <span style={{ padding: 6, color: "#666" }}>
            {options.length === 0 ? "Nothing to choose" : "No match"}
          </span>
        )}
      </div>
    </details>
  );
}

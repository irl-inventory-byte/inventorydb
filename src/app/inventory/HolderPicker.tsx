"use client";

import { useState } from "react";

/**
 * Correct status / location: choose the holder's ROLE first, then only people with that role are listed
 * in Holder. "All roles" lists everyone. Only the holder (name="holder") is sent with the form.
 */
export default function HolderPicker({
  people,
  roles,
}: {
  people: { id: string; name: string; role: string; roleLabel: string }[];
  roles: { value: string; label: string }[];
}) {
  const [role, setRole] = useState("");
  const [holder, setHolder] = useState("");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = people.filter((p) => (!role || p.role === role) && (!q || p.name.toLowerCase().includes(q)));
  // Keep the chosen holder selectable even if a later search hides them from the visible list.
  const chosenHolder = people.find((p) => p.id === holder);
  const holderOptions = chosenHolder && !shown.some((p) => p.id === holder) ? [chosenHolder, ...shown] : shown;

  return (
    <>
      <select
        aria-label="Holder role"
        value={role}
        onChange={(e) => {
          setRole(e.target.value);
          setHolder(""); // a new role starts with no holder chosen
        }}
      >
        <option value="">Role: all</option>
        {roles.map((r) => (
          <option key={r.value} value={r.value}>
            Role: {r.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name…"
        aria-label="Search holder name"
        style={{ width: 130, padding: "6px 8px", border: "1px solid #b5b5b5", borderRadius: 6, font: "inherit" }}
      />
      <select name="holder" aria-label="Holder" value={holder} onChange={(e) => setHolder(e.target.value)}>
        <option value="">{role || q ? `Holder: none (${shown.length} ${shown.length === 1 ? "person" : "people"})` : "Holder: none"}</option>
        {holderOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.roleLabel})
          </option>
        ))}
      </select>
    </>
  );
}
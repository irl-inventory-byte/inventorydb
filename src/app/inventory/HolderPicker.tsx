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
  const shown = people.filter((p) => !role || p.role === role);
  // Keep the chosen holder selectable even if a later role choice hides them from the visible list.
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
      <select name="holder" aria-label="Holder" value={holder} onChange={(e) => setHolder(e.target.value)}>
        <option value="">{role ? `Holder: none (${shown.length} ${shown.length === 1 ? "person" : "people"})` : "Holder: none"}</option>
        {holderOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.roleLabel})
          </option>
        ))}
      </select>
    </>
  );
}
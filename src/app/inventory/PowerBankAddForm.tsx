"use client";

import { useState, type CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import { addPowerBank } from "./power-bank-actions";

type Hubs = { hub_id: string; name: string }[];

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const inputStyle: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px" };

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Add power bank"}
    </button>
  );
}

/**
 * Admin and IM. Direct hand entry — there's no reference sheet for power banks, so every field is typed
 * in: Asset Tag, Brand, Model, Color, Capacity, Output and the Price/Penalty amount charged if it's lost.
 */
export default function PowerBankAddForm({ hubs = [] }: { hubs?: Hubs }) {
  const [brand, setBrand] = useState("Portronics");

  return (
    <form action={addPowerBank} aria-label="Add a power bank" style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <label style={fieldStyle}>
          <span>
            <strong>Asset Tag *</strong>
          </span>
          <input name="itemId" placeholder="Power Bank - xxxxx" autoComplete="off" spellCheck={false} required style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Home hub *</span>
          <select name="homeHub" defaultValue="" required style={inputStyle}>
            <option value="" disabled>
              Select home hub
            </option>
            {hubs.map((hub) => (
              <option key={hub.hub_id} value={hub.hub_id}>
                {hub.name}
              </option>
            ))}
          </select>
        </label>

        <label style={fieldStyle}>
          <span>Type</span>
          <input value="Power Bank" readOnly style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Brand</span>
          <input name="brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Model</span>
          <input name="model" placeholder="e.g. Halley 20k" style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Color</span>
          <input name="color" placeholder="e.g. Black" style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Capacity</span>
          <input name="capacity" placeholder="e.g. 20000 mAh" style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Output</span>
          <input name="output" placeholder="e.g. 65 W" style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Price / Penalty (₹)</span>
          <input name="price" type="number" inputMode="numeric" placeholder="e.g. 2000" style={inputStyle} />
        </label>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <AddButton />
      </div>
    </form>
  );
}
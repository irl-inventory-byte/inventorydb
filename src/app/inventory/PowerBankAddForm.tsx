"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useFormStatus } from "react-dom";
import styles from "../admin/admin.module.css";
import { addPowerBank, lookupPowerBank, type PowerBankLookup } from "./power-bank-actions";

type Hubs = { hub_id: string; name: string }[];

const EMPTY: PowerBankLookup = {
  assetTag: "",
  date: "",
  type: "Power Bank",
  brand: "",
  model: "",
  color: "",
  capacity: "",
  output: "",
  price: "",
};

// The details from the power bank sheet, in the order they are shown. "date" isn't shown here (per
// request) — it's still read from the sheet and saved on the item server-side (see power-bank-actions.ts),
// just not displayed or editable on this form.
const FIELDS: [keyof PowerBankLookup, string][] = [
  ["type", "Type"],
  ["brand", "Brand"],
  ["model", "Model"],
  ["color", "Color"],
  ["capacity", "Capacity"],
  ["output", "Output"],
  ["price", "Price / Penalty (₹)"],
];

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const inputStyle: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px" };

function SaveButton({ busy }: { busy: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={busy || pending}>
      {pending ? "Saving…" : "Add power bank"}
    </button>
  );
}

/**
 * Admin and IM. One box (required): scan or type the Asset Tag. The power bank is found in the power
 * bank sheet and every other field (Date, Type, Brand, Model, Color, Capacity, Output, Price/Penalty)
 * fills in by itself. Not in the sheet: the fields stay editable so the details can be typed in by hand.
 */
export default function PowerBankAddForm({ hubs = [] }: { hubs?: Hubs }) {
  const [find, setFind] = useState("");
  const [details, setDetails] = useState<PowerBankLookup>(EMPTY);
  const [found, setFound] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      requestId.current += 1;
    },
    [],
  );

  async function lookup(value: string) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!value.trim()) return;
    const current = ++requestId.current;
    setBusy(true);
    setNote("");
    try {
      const result = await lookupPowerBank(value);
      if (current !== requestId.current) return;
      if ("notFound" in result) {
        setFound(false);
        setNote(result.notFound);
        return;
      }
      if ("error" in result) {
        setFound(false);
        setNote(result.error);
        return;
      }
      setDetails(result);
      setFound(true);
      setNote("Details loaded from the power bank sheet. Review, then press Add power bank.");
    } catch {
      if (current !== requestId.current) return;
      setNote("Could not read the power bank sheet. Check it is shared with the service account, or enter details by hand.");
    } finally {
      if (current === requestId.current) setBusy(false);
    }
  }

  // Look up shortly after typing stops (a scanner types fast, so this runs once per scan).
  function changeFind(value: string) {
    setFind(value);
    setDetails(EMPTY);
    setFound(false);
    setNote("");
    requestId.current += 1;
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setBusy(false);
      return;
    }
    setBusy(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      void lookup(value);
    }, 600);
  }

  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void lookup(e.currentTarget.value);
    }
  };

  return (
    <form
      action={addPowerBank}
      aria-label="Add a power bank"
      onSubmit={(e) => {
        if (busy) e.preventDefault();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
          gap: 16,
          alignItems: "end",
        }}
      >
        <div style={{ ...fieldStyle, gridColumn: "span 2" }}>
          <label style={fieldStyle}>
            <span>
              <strong>Asset Tag *</strong>
            </span>
            <input
              name="itemId"
              value={find}
              onChange={(e) => changeFind(e.target.value)}
              onKeyDown={onEnter}
              placeholder="Scan the QR code, or type the Asset Tag"
              autoComplete="off"
              spellCheck={false}
              required
              style={{ ...inputStyle, fontSize: "1.05rem", padding: "12px 14px" }}
            />
          </label>
        </div>

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
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        {FIELDS.map(([k, label]) => (
          <label key={k} style={fieldStyle}>
            <span>{label}</span>
            <input
              name={k}
              value={details[k]}
              onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))}
              placeholder={found ? "—" : "Fills in from the sheet"}
              readOnly={k === "type"}
              inputMode={k === "price" ? "numeric" : undefined}
              style={inputStyle}
            />
          </label>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <button type="button" disabled={busy || !find.trim()} onClick={() => void lookup(find)}>
          {busy ? "Fetching…" : "Fetch details"}
        </button>
        <SaveButton busy={busy} />
      </div>

      <p className={styles.muted} role="status" aria-live="polite" style={{ margin: 0 }}>
        {busy
          ? "Looking up the power bank…"
          : note ||
            "Scan the QR code, or type the Asset Tag in the first box. Everything else fills in from the power bank sheet."}
      </p>
    </form>
  );
}
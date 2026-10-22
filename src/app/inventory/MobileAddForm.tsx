"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import styles from "../admin/admin.module.css";
import { addMobile, lookupMobile, type MobileLookup } from "./mobile-actions";

type Hub = { hub_id: string; name: string };
type Details = Omit<MobileLookup, "imei">;

const EMPTY: Details = {
  assetTag: "",
  serial: "",
  model: "",
  modelNo: "",
  category: "",
  manufacturer: "",
  storage: "",
  cost: "",
};

// The details from the mobile sheet, in the order they are shown.
const FIELDS: [keyof Details, string][] = [
  ["assetTag", "Asset Tag"],
  ["serial", "Serial"],
  ["model", "Model"],
  ["modelNo", "Model No."],
  ["category", "Category"],
  ["manufacturer", "Manufacturer"],
  ["storage", "Storage"],
  ["cost", "Cost (₹)"],
];

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const inputStyle: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px" };

function SaveButton({ busy }: { busy: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={busy || pending}>
      {pending ? "Saving…" : "Add mobile"}
    </button>
  );
}

/** Admin and IM: scan the phone's QR code (IMEI). Details load from the mobile sheet. */
export default function MobileAddForm({ hubs, defaultHub }: { hubs: Hub[]; defaultHub?: string }) {
  const [imei, setImei] = useState("");
  const [details, setDetails] = useState<Details>(EMPTY);
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
      const found = await lookupMobile(value);
      if (current !== requestId.current) return;
      if (!found) {
        setDetails(EMPTY);
        setNote("This IMEI is not in the mobile sheet. Enter the details by hand.");
        return;
      }
      if ("error" in found) {
        setDetails(EMPTY);
        setNote(found.error);
        return;
      }
      const { imei: clean, ...rest } = found;
      setImei(clean); // the QR code may hold more than the number: keep just the IMEI
      setDetails(rest);
      setNote("Details loaded from the mobile sheet. Review before saving.");
    } catch {
      if (current !== requestId.current) return;
      setDetails(EMPTY);
      setNote("Could not read the mobile sheet. Check it is shared with the service account, or enter details by hand.");
    } finally {
      if (current === requestId.current) setBusy(false);
    }
  }

  function changeImei(value: string) {
    setImei(value);
    setDetails(EMPTY);
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

  return (
    <form
      action={addMobile}
      aria-label="Add a mobile"
      onSubmit={(e) => {
        if (busy) e.preventDefault();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: 16,
          alignItems: "start",
        }}
      >
        <label style={fieldStyle}>
          <span>IMEI *</span>
          <input
            name="imei"
            value={imei}
            onChange={(e) => changeImei(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void lookup(e.currentTarget.value);
              }
            }}
            placeholder="Scan the QR code — details load automatically"
            autoComplete="off"
            spellCheck={false}
            inputMode="numeric"
            required
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span>Home hub *</span>
          <select name="homeHub" defaultValue={defaultHub ?? ""} required style={inputStyle}>
            <option value="" disabled>
              Choose the hub
            </option>
            {hubs.map((h) => (
              <option key={h.hub_id} value={h.hub_id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>

        {FIELDS.map(([k, label]) => (
          <label key={k} style={fieldStyle}>
            <span>{label}</span>
            <input
              name={k}
              value={details[k]}
              onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))}
              placeholder={label.replace(" (₹)", "")}
              inputMode={k === "cost" ? "numeric" : undefined}
              style={inputStyle}
            />
          </label>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <button type="button" disabled={busy || !imei.trim()} onClick={() => void lookup(imei)}>
          {busy ? "Fetching…" : "Fetch details"}
        </button>
        <SaveButton busy={busy} />
      </div>

      <p className={styles.muted} role="status" aria-live="polite" style={{ margin: 0 }}>
        {busy
          ? "Looking up the IMEI…"
          : note || "Scan the phone's QR code (IMEI). Details load from the mobile sheet. New mobiles start in stock."}
      </p>
    </form>
  );
}
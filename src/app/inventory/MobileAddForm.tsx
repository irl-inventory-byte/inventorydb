"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useFormStatus } from "react-dom";
import styles from "../admin/admin.module.css";
import { addMobile, lookupMobile, type MobileLookup } from "./mobile-actions";

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

// Typing or scanning any of these finds the phone in the mobile sheet and fills in everything else.
const KEYS = new Set<keyof Details>(["assetTag", "serial"]);

/** Admin and IM: scan the phone's QR code (IMEI), or type its Asset Tag or Serial. Details load from the sheet. */
export default function MobileAddForm({ homeHubName }: { homeHubName?: string }) {
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
      if ("notFound" in found) {
        setNote(found.notFound);
        return;
      }
      if ("error" in found) {
        setNote(found.error);
        return;
      }
      const { imei: clean, ...rest } = found;
      setImei(clean); // the QR code may hold more than the number: keep just the IMEI
      setDetails(rest);
      setNote("Details loaded from the mobile sheet. Review before saving.");
    } catch {
      if (current !== requestId.current) return;
      setNote("Could not read the mobile sheet. Check it is shared with the service account, or enter details by hand.");
    } finally {
      if (current === requestId.current) setBusy(false);
    }
  }

  // Start a lookup shortly after typing stops (a scanner types fast, so this runs once per scan).
  function changeKey(from: "imei" | keyof Details, value: string) {
    if (from === "imei") {
      setImei(value);
      setDetails(EMPTY);
    } else {
      setImei("");
      setDetails({ ...EMPTY, [from]: value });
    }
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
          <span>IMEI</span>
          <input
            name="imei"
            value={imei}
            onChange={(e) => changeKey("imei", e.target.value)}
            onKeyDown={onEnter}
            placeholder="Scan the QR code, or type"
            autoComplete="off"
            spellCheck={false}
            inputMode="numeric"
            style={inputStyle}
          />
        </label>

        <div style={fieldStyle}>
          <span>Home hub</span>
          <strong style={{ padding: "10px 0" }}>{homeHubName || "Instawork Robotics Labs"}</strong>
        </div>

        {FIELDS.map(([k, label]) => (
          <label key={k} style={fieldStyle}>
            <span>{label}</span>
            <input
              name={k}
              value={details[k]}
              onChange={(e) =>
                KEYS.has(k) ? changeKey(k, e.target.value) : setDetails((d) => ({ ...d, [k]: e.target.value }))
              }
              onKeyDown={KEYS.has(k) ? onEnter : undefined}
              placeholder={KEYS.has(k) ? `Type ${label} to find the phone` : label.replace(" (₹)", "")}
              inputMode={k === "cost" ? "numeric" : undefined}
              style={inputStyle}
            />
          </label>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          disabled={busy || !(imei.trim() || details.assetTag.trim() || details.serial.trim())}
          onClick={() =>
            void lookup(imei.trim() || details.assetTag.trim() || details.serial.trim())
          }
        >
          {busy ? "Fetching…" : "Fetch details"}
        </button>
        <SaveButton busy={busy || !homeHubName} />
      </div>

      <p className={styles.muted} role="status" aria-live="polite" style={{ margin: 0 }}>
        {busy
          ? "Looking up the IMEI…"
          : !homeHubName
            ? "No active hub named Instawork Robotics Labs. Add it on the Hubs page first."
            : note ||
              "Scan the phone's QR code (IMEI), or type its Asset Tag or Serial. Everything else loads from the mobile sheet."}
      </p>
    </form>
  );
}
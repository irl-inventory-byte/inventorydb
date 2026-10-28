"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useFormStatus } from "react-dom";
import styles from "../admin/admin.module.css";
import CameraAddBox from "./CameraAddBox";
import { cameraAddMobile } from "./camera-add";
import { addMobile, lookupMobile, type MobileLookup } from "./mobile-actions";

const EMPTY: MobileLookup = {
  imei: "",
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
const FIELDS: [keyof MobileLookup, string][] = [
  ["imei", "IMEI"],
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

/**
 * Admin and IM. One box (required): scan the phone's QR code, or type its IMEI, Asset Tag or Serial. The
 * phone is found in the mobile sheet and every other field fills in by itself.
 */
export default function MobileAddForm({ homeHubName }: { homeHubName?: string }) {
  const [find, setFind] = useState("");
  const [details, setDetails] = useState<MobileLookup>(EMPTY);
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
      const result = await lookupMobile(value);
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
      setNote("Details loaded from the mobile sheet. Review, then press Add mobile.");
    } catch {
      if (current !== requestId.current) return;
      setNote("Could not read the mobile sheet. Check it is shared with the service account, or enter details by hand.");
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
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
          gap: 16,
          alignItems: "end",
        }}
      >
        <div style={{ ...fieldStyle, gridColumn: "span 2" }}>
          <label style={fieldStyle}>
            <span>
              <strong>IMEI, Asset Tag or Serial *</strong>
            </span>
            <input
              name="find"
              value={find}
              onChange={(e) => changeFind(e.target.value)}
              onKeyDown={onEnter}
              placeholder="Scan the QR code, or type the IMEI, Asset Tag or Serial"
              autoComplete="off"
              spellCheck={false}
              required
              style={{ ...inputStyle, fontSize: "1.05rem", padding: "12px 14px" }}
            />
          </label>
          <CameraAddBox save={cameraAddMobile} />
        </div>
        <div style={fieldStyle}>
          <span>Home hub</span>
          <strong style={{ padding: "10px 0" }}>{homeHubName || "Instawork Robotics Labs"}</strong>
        </div>
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
              inputMode={k === "cost" || k === "imei" ? "numeric" : undefined}
              style={inputStyle}
            />
          </label>
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <button type="button" disabled={busy || !find.trim()} onClick={() => void lookup(find)}>
          {busy ? "Fetching…" : "Fetch details"}
        </button>
        <SaveButton busy={busy || !homeHubName} />
      </div>

      <p className={styles.muted} role="status" aria-live="polite" style={{ margin: 0 }}>
        {busy
          ? "Looking up the phone…"
          : !homeHubName
            ? "No active hub named Instawork Robotics Labs. Add it on the Hubs page first."
            : note ||
              "Scan the QR code, or type the IMEI, Asset Tag or Serial in the first box. Everything else fills in from the mobile sheet."}
      </p>
    </form>
  );
}
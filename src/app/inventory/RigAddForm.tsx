"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import styles from "../admin/admin.module.css";
import { addRig, lookupRig } from "./rig-actions";

type Hub = { hub_id: string; name: string };

const fieldStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, minWidth: 0 };
const inputStyle: CSSProperties = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px" };

function SaveButton({ busy }: { busy: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={busy || pending}>
      {pending ? "Saving…" : "Add rig"}
    </button>
  );
}

/** Rigs: home hub is always Bangalore, and there is no prism number. */
export default function RigAddForm({ homeHub }: { homeHub?: Hub }) {
  const [rigId, setRigId] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [price, setPrice] = useState("");
  const [details, setDetails] = useState<[string, string][]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const requestId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      requestId.current += 1;
    },
    []
  );

  function clear() {
    setBrand("");
    setModel("");
    setPrice("");
    setDetails([]);
  }

  async function lookup(value: string) {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const id = value.trim();
    if (!id) return;

    const current = ++requestId.current;
    setBusy(true);
    setNote("");

    try {
      const found = await lookupRig(id);
      if (current !== requestId.current) return;

      if (!found) {
        clear();
        setNote("Rig not found in the rig sheet. Enter the details and penalty by hand.");
        return;
      }

      setBrand(found.brand);
      setModel(found.model);
      setPrice(found.penalty);
      setDetails(found.details);
      setNote(
        found.penalty
          ? "Rig details loaded. Review before saving."
          : "Rig found, but the sheet has no penalty for it. Enter the penalty amount."
      );
    } catch {
      if (current !== requestId.current) return;
      clear();
      setNote("Could not read the rig sheet. Check it is shared with the service account, or enter details by hand.");
    } finally {
      if (current === requestId.current) setBusy(false);
    }
  }

  function changeId(value: string) {
    setRigId(value);
    clear();
    setNote("");
    requestId.current += 1;
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) return;
    setBusy(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      void lookup(value);
    }, 600);
  }

  return (
    <form
      action={addRig}
      aria-label="Add a rig"
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
          <span>Rig ID / Asset Tag *</span>
          <input
            name="itemId"
            value={rigId}
            onChange={(e) => changeId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void lookup(e.currentTarget.value);
              }
            }}
            placeholder="Scan or type — details load automatically"
            autoComplete="off"
            spellCheck={false}
            required
            style={inputStyle}
          />
        </label>

        <div style={fieldStyle}>
          <span>Home hub</span>
          {homeHub ? (
            <>
              <input type="hidden" name="homeHub" value={homeHub.hub_id} />
              <strong style={{ ...inputStyle, paddingLeft: 0 }}>{homeHub.name}</strong>
            </>
          ) : (
            <span className={styles.error} style={{ margin: 0 }}>
              No active hub named Bangalore. Add it on the Hubs page.
            </span>
          )}
        </div>

        <label style={fieldStyle}>
          <span>Brand</span>
          <input name="brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand" style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Model</span>
          <input name="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" style={inputStyle} />
        </label>

        <label style={fieldStyle}>
          <span>Penalty amount (₹) *</span>
          <input
            name="price"
            type="number"
            min={1}
            step={1}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="From the rig sheet, or type it"
            required
            style={inputStyle}
          />
        </label>
      </div>

      {details.length > 0 && (
        <dl className={styles.facts} style={{ margin: 0 }}>
          {details.map(([k, v]) => (
            <div key={k} className={styles.factRow}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <button type="button" disabled={busy || !rigId.trim()} onClick={() => void lookup(rigId)}>
          {busy ? "Fetching…" : "Fetch details"}
        </button>
        <SaveButton busy={busy || !homeHub} />
      </div>

      <p className={styles.muted} role="status" aria-live="polite" style={{ margin: 0 }}>
        {busy ? "Looking up the rig…" : note || "Scan a rig ID. Details load from the rig sheet. New rigs start as QC pending."}
      </p>
    </form>
  );
}
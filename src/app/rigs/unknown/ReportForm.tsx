"use client";

import { useState } from "react";
import styles from "../../handover/form.module.css";
import { addRigReport } from "./actions";

// Fits one Google Sheets cell (50,000 characters) with room to spare.
const MAX_CHARS = 45_000;

/** Shrink a photo on the phone to a small JPEG data: URL that fits in one sheet cell. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("not an image"));
      i.src = url;
    });
    for (const side of [640, 520, 420, 340, 260]) {
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of [0.7, 0.55, 0.4]) {
        const data = canvas.toDataURL("image/jpeg", q);
        if (data.length <= MAX_CHARS) return data;
      }
    }
    throw new Error("too big");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Add a report for an unknown rig: who (the login), where, why, and a photo. */
export type ReportHub = { id: string; name: string; city: string };
export type ReportPerson = { id: string; name: string; role: string; hub: string };

const ROLE_OPTIONS: [string, string][] = [
  ["fo", "FO"],
  ["ifo", "IFO"],
  ["im", "IM"],
  ["rig", "Rig team"],
  ["internal", "Internal team"],
  ["qc", "QC team"],
  ["hardware", "Hardware team"],
];

const selectStyle = {
  width: "100%",
  maxWidth: 480,
  padding: "8px 10px",
  border: "1px solid #c9c9c9",
  borderRadius: 6,
  font: "inherit",
  background: "#fff",
} as const;

export default function ReportForm({
  rig,
  who,
  hubs,
  people,
  defaultHub = "",
}: {
  rig: string;
  who: string;
  hubs: ReportHub[];
  people: ReportPerson[];
  defaultHub?: string;
}) {
  const [hub, setHub] = useState(defaultHub);
  const [role, setRole] = useState("");
  const [person, setPerson] = useState("");
  // People with the chosen role: those at the chosen location first, then everyone else with that role.
  const ofRole = people.filter((p) => p.role === role);
  const here = ofRole.filter((p) => p.hub === hub);
  const elsewhere = ofRole.filter((p) => p.hub !== hub);
  const hubName = new Map(hubs.map((h) => [h.id, h.name]));
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const onFile = async (file?: File) => {
    setError("");
    setPhoto("");
    if (!file) return;
    setBusy(true);
    try {
      setPhoto(await shrink(file));
    } catch {
      setError("This photo could not be used. Take it again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form action={addRigReport} className={styles.form} style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name="rig" value={rig} />
      <input type="hidden" name="photo" value={photo} />
      <div className={styles.field}>
        <span className={styles.label}>Reported by</span>
        <div className={styles.control}>
          <b>{who}</b>
          <p className={styles.hint}>Saved under your login.</p>
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="hub">
          Location *
        </label>
        <div className={styles.control}>
          <select id="hub" name="hub" required value={hub} onChange={(e) => setHub(e.target.value)} style={selectStyle}>
            <option value="" disabled>
              Choose the location (hub)
            </option>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
                {h.city && h.city !== h.name ? ` (${h.city})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="role">
          Role *
        </label>
        <div className={styles.control}>
          <select
            id="role"
            name="role"
            required
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPerson("");
            }}
            style={selectStyle}
          >
            <option value="" disabled>
              Who has the rig? Choose the role
            </option>
            {ROLE_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="person">
          Person *
        </label>
        <div className={styles.control}>
          <select id="person" name="person" required value={person} onChange={(e) => setPerson(e.target.value)} disabled={!role} style={selectStyle}>
            <option value="" disabled>
              {role ? (ofRole.length ? "Choose the person" : "No active person with this role") : "Choose the role first"}
            </option>
            {here.length > 0 && (
              <optgroup label={`At ${hubName.get(hub) ?? "this location"}`}>
                {here.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
            {elsewhere.length > 0 && (
              <optgroup label={hub ? "Other hubs" : "All hubs"}>
                {elsewhere.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({hubName.get(p.hub) ?? (p.hub || "no hub")})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <p className={styles.hint}>People with the chosen role; those at the chosen location are listed first.</p>
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="reason">
          Reason *
        </label>
        <div className={styles.control}>
          <textarea id="reason" name="reason" required rows={3} maxLength={1000} placeholder="Why it had no activity, what state it is in…" className={styles.textarea} />
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="photoFile">
          Photo *
        </label>
        <div className={styles.control}>
          <input id="photoFile" type="file" accept="image/*" capture="environment" required onChange={(e) => onFile(e.target.files?.[0])} />
          {busy && <p className={styles.hint}>Preparing the photo…</p>}
          {error && <p className={styles.error}>{error}</p>}
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="Photo to be saved" style={{ marginTop: 8, maxWidth: 220, borderRadius: 8, border: "1px solid #e5e7eb" }} />
          )}
          <p className={styles.hint}>Required. Take a photo of the rig. It is made smaller so it fits in the sheet.</p>
        </div>
      </div>
      <div className={styles.actions}>
        <button type="submit" disabled={busy || !photo}>
          Save report
        </button>
        {!photo && !busy && <span className={styles.hint}>Add the photo to save.</span>}
      </div>
    </form>
  );
}
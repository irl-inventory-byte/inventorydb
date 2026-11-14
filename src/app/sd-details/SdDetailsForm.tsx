"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { SdCardDuration } from "@/lib/schema";
import { formatIst } from "@/lib/time";
import { lookupSdDetailsBySerial } from "./actions";

const IC_NAMES = [
  "Aditya", "Anshitha", "Bhavana", "Hari Prasad M S", "Hemanth", "Kavya", "Kusuma H",
  "MALIAKA", "Mohit", "NAVEEN", "Niharika", "Prajakta", "Priyanshu", "Sohan", "Spoorthi",
  "Sumit", "Tejash", "Yashaswini", "Ritika", "Sujay", "Arush", "Nishanth", "Devesh",
  "Krishen", "Abhijnan", "Kshithi", "Shashwath", "Suhaib", "Kavin", "Smita", "Brunda",
  "vinay", "Nandadeep", "Nikshitha", "Nancy", "Franklin", "Akshay", "Guru",
];

export default function SdDetailsForm({
  team, action, memberLabel, memberOptions, foIfoOptions, cities, saved, error, recent, defaultMember,
}: {
  team: "im" | "rig";
  action: (formData: FormData) => void;
  memberLabel: string;
  memberOptions: { id: string; name: string }[];
  foIfoOptions: { id: string; name: string }[];
  cities: [string, { id: string; name: string }[]][];
  saved: boolean;
  error: string;
  recent: SdCardDuration[];
  defaultMember?: string;
}) {
  // These six are copied forward from the most recent prior entry for the same serial (see
  // lookupSdDetailsBySerial in ./actions) once the serial field loses focus — kept as controlled state
  // so the lookup can fill them in. Everything else on the form stays uncontrolled/native.
  const [foIfo, setFoIfo] = useState("");
  const [icName, setIcName] = useState("");
  const [icNumber, setIcNumber] = useState("");
  const [city, setCity] = useState("");
  const [duration, setDuration] = useState("0:00:00");
  const [rawClips, setRawClips] = useState("");
  const [autofillStatus, setAutofillStatus] = useState<"" | "looking" | "filled" | "none">("");
  // So the SD card date field can trigger the same lookup as the serial field — see its onBlur below.
  const serialRef = useRef<HTMLInputElement>(null);

  async function runLookup(rawSerial: string) {
    const serial = rawSerial.trim();
    if (!serial) return;
    setAutofillStatus("looking");
    try {
      const match = await lookupSdDetailsBySerial(serial);
      if (!match) {
        setAutofillStatus("none");
        return;
      }
      if (match.fo_ifo) setFoIfo(match.fo_ifo);
      if (match.ic_name) setIcName(match.ic_name);
      if (match.ic_number) setIcNumber(match.ic_number);
      if (match.city) setCity(match.city);
      if (match.duration) setDuration(match.duration);
      if (match.raw_clips) setRawClips(match.raw_clips);
      setAutofillStatus("filled");
    } catch {
      setAutofillStatus("none");
    }
  }

  const field: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.82rem", color: "#334155" };
  const input: CSSProperties = { fontSize: "0.9rem", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1" };

  return (
    <>
      {error && (
        <p style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: "8px 12px", borderRadius: 6, fontSize: "0.85rem" }}>
          {error}
        </p>
      )}
      {saved && (
        <p style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", padding: "8px 12px", borderRadius: 6, fontSize: "0.85rem" }}>
          Saved.
        </p>
      )}

      <form
        action={action}
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, alignItems: "end", marginBottom: 20 }}
      >
        <input type="hidden" name="team" value={team} />
        <label style={field}>
          SD card date *
          <input
            type="date"
            name="card_date"
            required
            max={new Date().toISOString().slice(0, 10)}
            style={input}
            onBlur={(e) => {
              // Whichever of serial/date is filled in second triggers the lookup — so it fires
              // whether the card is scanned first or the date is picked first.
              if (e.currentTarget.value && serialRef.current?.value.trim()) runLookup(serialRef.current.value);
            }}
          />
        </label>
        <label style={field}>
          {memberLabel} *
          <input
            list="member-options"
            name="team_member"
            required
            defaultValue={defaultMember || ""}
            placeholder={`Select or type ${memberLabel}`}
            autoComplete="off"
            style={input}
          />
          <datalist id="member-options">
            {memberOptions.map((m) => (
              <option key={m.id} value={m.name} />
            ))}
          </datalist>
        </label>
        <label style={field}>
          SD card serial number / asset tag *
          <input
            type="text"
            name="serial"
            required
            placeholder="Serial or asset tag"
            style={input}
            ref={serialRef}
            onBlur={(e) => runLookup(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runLookup(e.currentTarget.value);
              }
            }}
          />
          {autofillStatus === "looking" && <span style={{ fontSize: "0.72rem", color: "#64748b" }}>Looking up this card…</span>}
          {autofillStatus === "filled" && (
            <span style={{ fontSize: "0.72rem", color: "#166534" }}>Filled in from the last entry for this card — check before submitting.</span>
          )}
          {autofillStatus === "none" && <span style={{ fontSize: "0.72rem", color: "#64748b" }}>No earlier entry found for this card.</span>}
        </label>
        <label style={field}>
          FO / IFO *
          <input
            list="foifo-options"
            name="fo_ifo"
            required
            placeholder="Select or type FO / IFO"
            autoComplete="off"
            style={input}
            value={foIfo}
            onChange={(e) => setFoIfo(e.target.value)}
          />
          <datalist id="foifo-options">
            {foIfoOptions.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </label>
        <label style={field}>
          IC name *
          <input
            list="ic-name-options"
            name="ic_name"
            required
            placeholder="Select or type IC name"
            autoComplete="off"
            style={input}
            value={icName}
            onChange={(e) => setIcName(e.target.value)}
          />
          <datalist id="ic-name-options">
            {IC_NAMES.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label style={field}>
          City *
          <select name="city" required style={input} value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="" disabled>
              Select city
            </option>
            {cities.map(([c]) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={field}>
          IC-Number (must start with IC-) *
          <input
            type="text"
            name="ic_number"
            required
            pattern="IC-.*"
            title="Must start with IC-"
            placeholder="IC-123"
            style={input}
            value={icNumber}
            onChange={(e) => setIcNumber(e.target.value)}
          />
        </label>
        <label style={field}>
          Duration (HH:MM:SS) *
          <input
            type="text"
            name="duration"
            required
            pattern="\d{1,2}:\d{2}:\d{2}"
            placeholder="HH:MM:SS (e.g. 01:30:45)"
            style={input}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </label>
        {team === "rig" && (
          <label style={field}>
            Failed hours (HH:MM:SS)
            <input
              type="text"
              name="failed_hours"
              pattern="\d{1,2}:\d{2}:\d{2}"
              placeholder="HH:MM:SS, leave blank if none"
              style={input}
              defaultValue="0:00:00"
            />
          </label>
        )}
        {team === "rig" && (
          <label style={field}>
            Failed clips
            <input type="number" name="failed_raw_clips" min={0} placeholder="e.g. 2, leave blank if none" style={input} />
          </label>
        )}
        <label style={field}>
          No. of raw clips *
          <input
            type="number"
            name="raw_clips"
            required
            min={0}
            placeholder="e.g. 25"
            style={input}
            value={rawClips}
            onChange={(e) => setRawClips(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            type="submit"
            style={{ fontSize: "0.9rem", padding: "9px 18px", borderRadius: 6, border: "1px solid #1e293b", background: "#1e293b", color: "#fff", cursor: "pointer" }}
          >
            Submit
          </button>
        </div>
      </form>

      {recent.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>
                <th style={{ padding: "6px 8px" }}>Date</th>
                {team === "rig" && <th style={{ padding: "6px 8px" }}>Team</th>}
                <th style={{ padding: "6px 8px" }}>{memberLabel}</th>
                <th style={{ padding: "6px 8px" }}>FO / IFO</th>
                <th style={{ padding: "6px 8px" }}>IC</th>
                <th style={{ padding: "6px 8px" }}>City</th>
                <th style={{ padding: "6px 8px" }}>Serial</th>
                <th style={{ padding: "6px 8px" }}>Duration</th>
                {team === "rig" && <th style={{ padding: "6px 8px" }}>Failed</th>}
                {team === "rig" && <th style={{ padding: "6px 8px" }}>Failed clips</th>}
                <th style={{ padding: "6px 8px" }}>Clips</th>
                <th style={{ padding: "6px 8px" }}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.record_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px 8px" }}>{r.card_date}</td>
                  {team === "rig" && (
                    <td style={{ padding: "6px 8px" }}>{r.sub_team === "productivity" ? "Productivity team" : "Rig team"}</td>
                  )}
                  <td style={{ padding: "6px 8px" }}>{r.team_member}</td>
                  <td style={{ padding: "6px 8px" }}>{r.fo_ifo || "—"}</td>
                  <td style={{ padding: "6px 8px" }}>
                    {r.ic_name} {r.ic_number && `(${r.ic_number})`}
                  </td>
                  <td style={{ padding: "6px 8px" }}>{r.city}</td>
                  <td style={{ padding: "6px 8px" }}>{r.serial}</td>
                  <td style={{ padding: "6px 8px" }}>{r.duration}</td>
                  {team === "rig" && <td style={{ padding: "6px 8px" }}>{r.failed_hours || "—"}</td>}
                  {team === "rig" && <td style={{ padding: "6px 8px" }}>{r.failed_raw_clips || "—"}</td>}
                  <td style={{ padding: "6px 8px" }}>{r.raw_clips}</td>
                  <td style={{ padding: "6px 8px", color: "#64748b" }}>{r.recorded_at ? formatIst(r.recorded_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
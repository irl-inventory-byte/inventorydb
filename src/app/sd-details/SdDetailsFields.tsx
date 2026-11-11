"use client";

import { useRef, useState, type CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import { lookupSdDetailsBySerial } from "./actions";

const field: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: "0.78rem", color: "#334155" };
const input: CSSProperties = { padding: "7px 9px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.88rem", background: "#fff" };

// Hard-coded IC name list (given by the user directly — no admin page to manage this yet).
const IC_NAMES = [
  "Aditya", "Anshitha", "Bhavana", "Hari Prasad M S", "Hemanth", "Kavya", "Kusuma H",
  "MALIAKA", "Mohit", "NAVEEN", "Niharika", "Prajakta", "Priyanshu", "Sohan", "Spoorthi",
  "Sumit", "Tejash", "Yashaswini", "Ritika", "Sujay", "Arush", "Nishanth", "Devesh",
  "Krishen", "Abhijnan", "Kshithi", "Shashwath", "Suhaib", "Kavin", "Smita", "Brunda",
  "vinay", "Nandadeep", "Nikshitha", "Nancy", "Franklin", "Akshay", "Guru",
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        fontSize: "0.88rem",
        fontWeight: 600,
        padding: "8px 18px",
        borderRadius: 6,
        border: "1px solid #1e293b",
        background: pending ? "#64748b" : "#1e293b",
        color: "#fff",
        cursor: pending ? "not-allowed" : "pointer",
      }}
    >
      {pending ? "Saving…" : "Submit"}
    </button>
  );
}

/**
 * The add-entry form for SD Card Duration Hour details (shared by the IM and Rig pages).
 *
 * Two things this fixes over a plain server-rendered form:
 *  1. Once BOTH the SD card date and the serial number / asset tag are filled in, leaving the serial
 *     field (blur, or pressing Enter) looks up the most recent prior entry for that serial and
 *     fills in FO/IFO, IC name, IC-Number, city, duration and raw clips — so the rest of the form only
 *     ever fetches once both of those are actually in hand, not on every keystroke. Nothing is
 *     overwritten if the person has already started typing those fields themselves.
 *  2. The Submit button disables itself (and says "Saving…") the moment the form is submitted, so a
 *     second click while the first submission is still in flight can no longer save a duplicate row.
 */
export default function SdDetailsFields({
  team,
  action,
  memberLabel,
  memberOptions,
  foIfoOptions,
  cities,
  defaultMember,
}: {
  team: "im" | "rig";
  action: (formData: FormData) => void;
  memberLabel: string;
  memberOptions: { id: string; name: string }[];
  foIfoOptions: { id: string; name: string }[];
  cities: [string, { id: string; name: string }[]][];
  defaultMember?: string;
}) {
  const dateRef = useRef<HTMLInputElement>(null);
  const serialRef = useRef<HTMLInputElement>(null);
  const foIfoRef = useRef<HTMLInputElement>(null);
  const icNameRef = useRef<HTMLInputElement>(null);
  const icNumberRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLSelectElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);
  const rawClipsRef = useRef<HTMLInputElement>(null);

  const [looking, setLooking] = useState(false);
  const [note, setNote] = useState("");
  const lastChecked = useRef(""); // avoid re-fetching for the same date+serial pair twice in a row

  async function maybeLookup() {
    const date = dateRef.current?.value.trim() ?? "";
    const serial = serialRef.current?.value.trim() ?? "";
    // Only once BOTH are filled in — this is the whole point of the change: no fetch from a bare serial.
    if (!date || !serial) return;

    const key = `${date}|${serial}`;
    if (key === lastChecked.current) return;
    lastChecked.current = key;

    setLooking(true);
    setNote("");
    try {
      const found = await lookupSdDetailsBySerial(serial);
      if (!found) {
        setNote("No prior entry for this serial — fill in the rest manually.");
        return;
      }
      // Only fill a field if it's still empty, so edits already made aren't clobbered.
      if (foIfoRef.current && !foIfoRef.current.value.trim()) foIfoRef.current.value = found.fo_ifo;
      if (icNameRef.current && !icNameRef.current.value.trim()) icNameRef.current.value = found.ic_name;
      if (icNumberRef.current && !icNumberRef.current.value.trim()) icNumberRef.current.value = found.ic_number;
      if (cityRef.current && !cityRef.current.value.trim() && found.city) cityRef.current.value = found.city;
      if (durationRef.current && !durationRef.current.value.trim()) durationRef.current.value = found.duration;
      if (rawClipsRef.current && !rawClipsRef.current.value.trim()) rawClipsRef.current.value = found.raw_clips;
      setNote("Filled in from this serial's last entry — review before submitting.");
    } catch {
      setNote("Couldn't look up this serial — fill in the rest manually.");
    } finally {
      setLooking(false);
    }
  }

  return (
    <form
      action={action}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 10,
        padding: 14,
        border: "1px solid #cbd5e1",
        borderRadius: 10,
        background: "#f8fafc",
        maxWidth: 760,
      }}
    >
      <input type="hidden" name="team" value={team} />

      {team === "rig" && (
        <label style={field}>
          Team *
          <select name="sub_team" required defaultValue="" style={input}>
            <option value="" disabled>
              Select team
            </option>
            <option value="rig">Rig team</option>
            <option value="productivity">Productivity team</option>
          </select>
        </label>
      )}

      <label style={field}>
        SD card date *
        <input
          ref={dateRef}
          type="date"
          name="card_date"
          required
          max={new Date().toISOString().slice(0, 10)}
          onBlur={() => void maybeLookup()}
          style={input}
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
        FO / IFO
        <input
          ref={foIfoRef}
          list="foifo-options"
          name="fo_ifo"
          placeholder="Select or type FO / IFO"
          autoComplete="off"
          style={input}
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
          ref={icNameRef}
          list="ic-name-options"
          name="ic_name"
          required
          placeholder="Select or type IC name"
          autoComplete="off"
          style={input}
        />
        <datalist id="ic-name-options">
          {IC_NAMES.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </label>

      <label style={field}>
        City *
        <select ref={cityRef} name="city" required defaultValue="" style={input}>
          <option value="" disabled>
            Select city
          </option>
          {cities.map(([city]) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
      </label>

      <label style={field}>
        IC-Number (must start with IC-) *
        <input ref={icNumberRef} type="text" name="ic_number" required pattern="IC-.*" title="Must start with IC-" placeholder="IC-123" style={input} />
      </label>

      <label style={field}>
        SD card serial number / asset tag *
        <input
          ref={serialRef}
          type="text"
          name="serial"
          required
          placeholder="Serial or asset tag"
          onBlur={() => void maybeLookup()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void maybeLookup();
            }
          }}
          style={input}
        />
      </label>

      <label style={field}>
        Duration (HH:MM:SS) *
        <input ref={durationRef} type="text" name="duration" required pattern="\d{1,2}:\d{2}:\d{2}" placeholder="HH:MM:SS (e.g. 01:30:45)" style={input} />
      </label>

      {/* Rig form only — not shown on the IM form. */}
      {team === "rig" && (
        <label style={field}>
          Failed hours (HH:MM:SS)
          <input type="text" name="failed_hours" pattern="\d{1,2}:\d{2}:\d{2}" placeholder="HH:MM:SS, leave blank if none" style={input} />
        </label>
      )}

      <label style={field}>
        No. of raw clips *
        <input ref={rawClipsRef} type="number" name="raw_clips" required min={0} placeholder="e.g. 25" style={input} />
      </label>

      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <SubmitButton />
      </div>

      {(looking || note) && (
        <p
          role="status"
          aria-live="polite"
          style={{ gridColumn: "1 / -1", margin: 0, fontSize: "0.78rem", color: "#64748b" }}
        >
          {looking ? "Looking up this serial's last entry…" : note}
        </p>
      )}
    </form>
  );
}
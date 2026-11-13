"use client";

import { useState } from "react";
import styles from "../form.module.css";

export interface PersonGroup {
  role: string;
  label: string;
  people: { id: string; label: string; city?: string }[];
}

// A name typed by hand (not in People). Listed internal people are the "internal" group.
const INTERNAL = "typed_internal";

/**
 * "Send to": the person AND the location, both required. The person is picked in two steps (category,
 * then a person from it) so the list stays short. Choosing "Internal" swaps the person dropdown for a
 * free-text name field, submitted separately as `internalName` — there's no matching row in People for
 * a typed name, so the card is recorded as "With internal" and shows under that name directly.
 * The location is never filled in for you: it starts empty and has to be chosen every time, because an
 * FO or IFO may be working away from their own hub.
 * Field officers: a City list appears too, so the long FO list can be narrowed to one city first.
 */
export default function SendToFields({
  groups,
  hubs,
  allowInternal = true,
  bangalore,
  rigTeam,
  productivityTeam,
  alwaysBangalore = false,
}: {
  groups: PersonGroup[];
  hubs: { id: string; name: string }[];
  allowInternal?: boolean;
  bangalore?: { id: string; name: string }; // QC and hardware teams always work here
  rigTeam?: { id: string; name: string }; // the Rig team's own location
  productivityTeam?: { id: string; name: string }; // the Productivity team's own, separate location —
  // the two sub-teams used to share one hub; whichever sub-team is chosen below now auto-fills the
  // matching hub instead of always defaulting to the Rig team's.
  alwaysBangalore?: boolean; // the sender is the QC or hardware team: every send stays at Bangalore
}) {
  const [role, setRole] = useState("");
  const [person, setPerson] = useState("");
  const [internalName, setInternalName] = useState("");
  const [hub, setHub] = useState("");
  const [city, setCity] = useState("");
  // No default: "Rig team" used to be pre-selected here, so a sender who didn't notice this dropdown
  // (easy to miss — it only appears for the "Rig" category) silently recorded every send as the Rig
  // team even when it was actually going to the Productivity team. That default is also what the
  // dashboard's with_rig count falls back to (`i.sub_team || "rig"`), so the two defaults compounded:
  // nothing ever landed on "Productivity team" unless someone actively changed this dropdown. Starting
  // blank and requiring a real choice (see the empty disabled option below) stops new sends from being
  // silently misattributed; it does not correct items already recorded under the old default.
  const [subTeam, setSubTeam] = useState("");
  const isInternal = role === INTERNAL;
  const isRig = role === "rig";
  const isFo = role === "fo";
  const all = groups.find((g) => g.role === role)?.people ?? [];
  // FO only: the cities the field officers are in, and the list narrowed to the chosen city.
  const cities = isFo ? [...new Set(all.map((p) => p.city || "").filter(Boolean))].sort((a, b) => a.localeCompare(b)) : [];
  const people = isFo && city ? all.filter((p) => p.city === city) : all;

  return (
    <>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={isInternal ? "internalName" : "recipient"}>
          Send to (person)
        </label>
        <div className={styles.control}>
          <div className={styles.pair}>
            <select
              aria-label="Category"
              value={role}
              required
              onChange={(e) => {
                const newRole = e.target.value;
                setRole(newRole);
                setPerson(""); // a person from the old category must not stay selected
                setInternalName("");
                setCity("");
                setSubTeam(""); // force an explicit rig/productivity choice again for the new category
                setHub(""); // the hub now depends on that choice (see the sub_team select below)
              }}
            >
              <option value="">Select a category</option>
              {groups.map((g) => (
                <option key={g.role} value={g.role}>
                  {g.label} ({g.people.length})
                </option>
              ))}
              {allowInternal && <option value={INTERNAL}>Other internal person (type a name)</option>}
            </select>
            {/* The category the person was chosen under (e.g. "qc"), for people who also have a secondary role. */}
            {!isInternal && role && <input type="hidden" name="recipientRole" value={role} />}
            {isInternal ? (
              <input
                id="internalName"
                name="internalName"
                type="text"
                value={internalName}
                onChange={(e) => setInternalName(e.target.value)}
                placeholder="Enter the person's name"
                required
                autoComplete="off"
              />
            ) : (
              <select
                id="recipient"
                name="recipient"
                aria-label="Person"
                value={person}
                required
                disabled={!role}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">
                  {!role ? "Choose a category first" : isFo && city ? `Select a field officer in ${city} (${people.length})` : "Select a person"}
                </option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          {isRig && (
            <div className={styles.pair} style={{ marginTop: 8 }}>
              <select
                aria-label="Which team: Rig team or Productivity team"
                name="sub_team"
                value={subTeam}
                required
                onChange={(e) => {
                  const newSubTeam = e.target.value;
                  setSubTeam(newSubTeam);
                  // Each sub-team now has its own hub — fill the location with the right one, but it
                  // stays a normal, changeable dropdown below in case that's wrong for this send.
                  if (newSubTeam === "rig" && rigTeam) setHub(rigTeam.id);
                  else if (newSubTeam === "productivity" && productivityTeam) setHub(productivityTeam.id);
                }}
              >
                <option value="" disabled>
                  Choose rig or productivity team
                </option>
                <option value="rig">Rig team</option>
                <option value="productivity">Productivity team</option>
              </select>
              <span className={styles.hint} style={{ alignSelf: "center", margin: 0 }}>
                Different hubs for each team now — choose which team this is actually going to today.
              </span>
            </div>
          )}
          {isFo && cities.length > 0 && (
            <div className={styles.pair} style={{ marginTop: 8 }}>
              <select
                aria-label="City of the field officer"
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setPerson(""); // pick again from the shorter list
                }}
              >
                <option value="">All cities ({all.length} FOs)</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c} ({all.filter((p) => p.city === c).length})
                  </option>
                ))}
              </select>
              <span className={styles.hint} style={{ alignSelf: "center", margin: 0 }}>
                Choose the city first to shorten the FO list.
              </span>
            </div>
          )}
          <p className={styles.hint}>
            {isInternal ? (
              <>Recorded as &quot;With internal&quot;, under the name you type. Receive it back the same way as any other item.</>
            ) : (
              <>
                IM: waits to be received. IFO: traveling. FO: with the field officer. Rig: with the rig team. QC /
                Hardware: with that team.
              </>
            )}
          </p>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="hub">
          Send to (location)
        </label>
        <div className={styles.control}>
          {isRig && subTeam === "rig" && !rigTeam ? (
            <p className={styles.error}>
              No &quot;Rig team&quot; hub found. Add one in Manage hubs (named &quot;Rig team&quot;) before sending to the rig team.
            </p>
          ) : isRig && subTeam === "productivity" && !productivityTeam ? (
            <p className={styles.error}>
              No &quot;Productivity team&quot; hub found. Add one in Manage hubs (named &quot;Productivity team&quot;) before sending to
              the productivity team.
            </p>
          ) : bangalore && (alwaysBangalore || role === "qc" || role === "hardware") ? (
            <>
              <input type="hidden" name="hub" value={bangalore.id} />
              <strong id="hub">{bangalore.name}</strong>
              <p className={styles.hint}>The QC and hardware teams always work at {bangalore.name}.</p>
            </>
          ) : (
          <>
          <select
            id="hub"
            name="hub"
            value={hub}
            required
            onChange={(e) => setHub(e.target.value)}
          >
            <option value="">Select a location</option>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <p className={styles.hint}>
            Where the items will be recorded. Choose it every time: it is not filled in from the person, because they
            may be working at another hub.
          </p>
          </>
          )}
        </div>
      </div>
    </>
  );
}
"use client";

import { useRef, useState } from "react";
import styles from "../../handover/form.module.css";

export interface OverdueItem {
  id: string;
  label: string; // "SD card · SanDisk Extreme"
  since: string; // formatted, e.g. "17 Nov 2026, 6:40 pm"
  hoursAgo: number;
}

/**
 * Items + Send to (person), for the "Transfer between FOs" section of the IC Transfer page (see
 * app/ic/actions.ts's transferFoToFo). Items are typed/scanned IDs, not picked off a scan box tied to
 * one hub's in-stock list — these items are already with an FO somewhere, not in Bangalore stock, so
 * there's no single "current location" list to scan against here. The server validates that each one
 * is actually "with_fo" before moving it.
 *
 * When `overdueItems` is given (a "From" FO was picked above — see FromFoPicker.tsx and page.tsx),
 * this also shows a checklist of that FO's items held 48+ hours with no hub submission, each with its
 * own checkbox — ticking one writes its id into the Items box below instead of typing/scanning it.
 *
 * When `lockedCity` is given, the recipient must be in that same city (the "From" FO's city) — the
 * City dropdown becomes a fixed label instead of a choice, and the Name dropdown only lists FOs there.
 */
export default function FoToFoFields({
  fos,
  overdueItems,
  lockedCity,
  excludeId,
}: {
  fos: { id: string; name: string; city: string }[];
  overdueItems?: OverdueItem[];
  lockedCity?: string;
  excludeId?: string;
}) {
  const [recipient, setRecipient] = useState("");
  const [city, setCity] = useState(lockedCity ?? "");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const taRef = useRef<HTMLTextAreaElement>(null);

  const cities = [...new Set(fos.map((f) => f.city))].sort((a, b) => a.localeCompare(b));
  const fosInCity = fos.filter((f) => f.city === city && f.id !== excludeId);

  const toggleItem = (id: string, on: boolean) => {
    const ta = taRef.current;
    if (!ta) return;
    const lines = ta.value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const set = new Set(lines);
    if (on) set.add(id);
    else set.delete(id);
    ta.value = [...set].join("\n");
    setChecked(new Set(set));
  };

  const allChecked = !!overdueItems?.length && overdueItems.every((i) => checked.has(i.id));
  const toggleAll = () => {
    const ta = taRef.current;
    if (!ta || !overdueItems) return;
    if (allChecked) {
      ta.value = "";
      setChecked(new Set());
    } else {
      ta.value = overdueItems.map((i) => i.id).join("\n");
      setChecked(new Set(overdueItems.map((i) => i.id)));
    }
  };

  return (
    <>
      {overdueItems && (
        <div className={styles.field}>
          <label className={styles.label}>48h+ with no hub submission</label>
          <div className={styles.control}>
            {overdueItems.length === 0 ? (
              <p className={styles.hint}>
                Nothing overdue — every item this FO holds was last updated within the last 48 hours.
              </p>
            ) : (
              <>
                <p className={styles.hint} style={{ marginBottom: 6 }}>
                  {overdueItems.length} item{overdueItems.length === 1 ? "" : "s"} held 48+ hours with no
                  submission back to a hub. Tick the ones to move — they&apos;re added to Items below.
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, fontWeight: 600 }}>
                  <input type="checkbox" checked={allChecked} onChange={() => toggleAll()} />
                  Select all
                </label>
                <div
                  style={{
                    border: "1px solid var(--border, #e2e8f0)",
                    borderRadius: 8,
                    maxHeight: 260,
                    overflowY: "auto",
                  }}
                >
                  {overdueItems.map((item) => (
                    <label
                      key={item.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 10px",
                        borderBottom: "1px solid var(--border, #e2e8f0)",
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(item.id)}
                        onChange={(e) => toggleItem(item.id, e.target.checked)}
                      />
                      <span style={{ flex: 1 }}>
                        <strong>{item.id}</strong> — {item.label}
                      </span>
                      <span className={styles.hint} style={{ whiteSpace: "nowrap" }}>
                        since {item.since} ({Math.floor(item.hoursAgo)}h)
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="foScanned">
          Items
        </label>
        <div className={styles.control}>
          <textarea
            id="foScanned"
            name="scanned"
            ref={taRef}
            rows={6}
            className={styles.textarea}
            placeholder="Type or scan item IDs here, one per line — or tick items above."
            required
          />
          <p className={styles.hint}>Only items currently with an FO can be moved this way.</p>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="foRecipientCity">
          Send to (person)
        </label>
        <div className={styles.control}>
          {lockedCity ? (
            <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
              {lockedCity} <span className={styles.hint}>(fixed — same city as the FO above)</span>
            </p>
          ) : (
            <select
              id="foRecipientCity"
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setRecipient("");
              }}
            >
              <option value="">Select a city</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <select
            id="foRecipient"
            name="recipient"
            required
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={!city}
            style={{ marginTop: 8 }}
          >
            <option value="">{city ? "Select a field officer" : "Pick a city first"}</option>
            {fosInCity.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className={styles.hint}>Moves directly to this FO — happens immediately, no confirmation needed from either side.</p>
        </div>
      </div>
    </>
  );
}
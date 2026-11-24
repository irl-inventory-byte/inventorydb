"use client";

import { useMemo, useState } from "react";
import { ITEM_TYPE_LABELS, ROLE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { classifyScans } from "@/lib/scan";
import { ROLES, STATUSES, type Status } from "@/lib/schema";
import CameraScanButton, { appendLine, type ScanOutcome } from "../CameraScanButton";
import MultiSelect from "../inventory/MultiSelect";
import { reportLostScan } from "./actions";

// A Google Sheets cell holds at most 50,000 characters; the phone shrinks the photo to fit under this
// (same limit and approach as the Rig Audit report form — see rigs/unknown/ReportForm.tsx's shrink()).
const MAX_PHOTO_CHARS = 45_000;

/** Shrink a photo on the phone to a small JPEG data: URL that fits in one sheet cell. */
async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error("not an image"));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1000 / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const q of [0.7, 0.55, 0.4]) {
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length <= MAX_PHOTO_CHARS) return data;
    }
    throw new Error("too large");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A PDF can't be re-encoded smaller the way a photo can (no quality slider), so this just reads it
 * as-is and checks it actually fits the same sheet-cell limit — most real PDFs won't (45,000 base64
 * characters is only around 33KB of actual file), so this is expected to reject most PDFs with a
 * clear message rather than silently truncating one.
 */
function readPdfAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result ?? "");
      if (data.length <= MAX_PHOTO_CHARS) resolve(data);
      else reject(new Error("too large"));
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Admin/IM only: scan (or paste) item codes and report them as Lost or Broken right from this page,
 * instead of going to the Inventory page's Correct form. Reuses the same "correct" event under the
 * hood (see lib/lost.ts), so the report shows up exactly like one made there.
 */
export default function ReportLostScan({
  status,
  items,
  hubs,
  people,
}: {
  status: Status;
  items: { id: string; status: Status; type?: string }[];
  hubs: { id: string; name: string; city: string }[];
  people: { id: string; name: string; role: string }[];
}) {
  const [personRoles, setPersonRoles] = useState<string[]>([]);
  const toggleRole = (r: string) =>
    setPersonRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  const peopleOptions = useMemo(
    () =>
      people
        .filter((p) => personRoles.length === 0 || personRoles.includes(p.role))
        .map((p) => ({ value: p.id, label: p.name })),
    [people, personRoles],
  );
  const roleSummary =
    personRoles.length === 0
      ? "Any role"
      : personRoles.length <= 2
        ? personRoles.map((r) => ROLE_LABELS[r as (typeof ROLES)[number]] ?? r).join(", ")
        : `${personRoles.length} selected`;
  // Cities in display order, each with its hubs (a city may have more than one hub).
  const cities = useMemo(() => {
    const byCity = new Map<string, { id: string; name: string }[]>();
    for (const h of hubs) {
      if (!byCity.has(h.city)) byCity.set(h.city, []);
      byCity.get(h.city)!.push({ id: h.id, name: h.name });
    }
    return [...byCity.entries()];
  }, [hubs]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const label = status === "damaged" ? "broken" : "lost";
  const [photo, setPhoto] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const onPhotoFile = async (file?: File) => {
    setPhotoError("");
    setPhoto("");
    if (!file) return;
    setPhotoBusy(true);
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      setPhoto(isPdf ? await readPdfAsDataUrl(file) : await shrinkPhoto(file));
    } catch {
      setPhotoError(
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
          ? "This PDF is too large to attach — try a smaller file, or attach a photo instead."
          : "This photo could not be used. Take it again.",
      );
    } finally {
      setPhotoBusy(false);
    }
  };
  const isPdfPhoto = photo.startsWith("data:application/pdf");

  const statuses = useMemo(() => new Map(items.map((i) => [i.id, i.status])), [items]);
  const typeOf = useMemo(() => new Map(items.map((i) => [i.id, i.type ?? "sd_card"])), [items]);
  // Power banks are stored as "Power Bank - <number>" (see power-bank-actions.ts), but what's printed
  // on the device (or typed by hand) is usually just the number. Map bare numbers to their full id so
  // those still match here, the same way mobiles are found by IMEI elsewhere in this app.
  const powerBankByNumber = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of items) {
      if (i.type !== "power_bank") continue;
      const m = /^Power Bank - (\d+)$/.exec(i.id);
      if (m) map.set(m[1], i.id);
    }
    return map;
  }, [items]);
  const resolveCode = (line: string) => {
    const trimmed = line.trim();
    return /^\d+$/.test(trimmed) ? (powerBankByNumber.get(trimmed) ?? line) : line;
  };
  const resolveText = (value: string) =>
    value
      .split(/\r?\n/)
      .map(resolveCode)
      .join("\n");
  // Anything not already at the target status can be reported.
  const allowed = useMemo(() => new Set(STATUSES.filter((s) => s !== status)), [status]);
  const results = useMemo(() => classifyScans(resolveText(text), statuses, allowed), [text, statuses, allowed, powerBankByNumber]);
  const ready = results.filter((r) => r.state === "ok").length;
  const duplicate = results.filter((r) => r.state === "duplicate").length;
  const alreadyMarked = results.filter((r) => r.state === "wrong").length;

  function cameraOutcome(code: string): ScanOutcome {
    const r = classifyScans(resolveCode(code), statuses, allowed)[0];
    if (!r || !r.id) return { ok: false, message: "Not found in the inventory" };
    const type = ITEM_TYPE_LABELS[typeOf.get(r.id) ?? "sd_card"];
    if (r.state === "wrong") return { id: r.id, type, ok: false, message: `Already ${label}` };
    return { id: r.id, type, ok: true, message: `Will be marked ${label}` };
  }

  return (
    <details style={{ margin: "4px 0 16px" }}>
      <summary style={{ cursor: "pointer", color: "#1d4ed8", fontWeight: 600 }}>Scan to report {label} ▾</summary>
      <form
        action={reportLostScan}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          marginTop: 8,
          padding: 12,
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          background: "#f8fafc",
          maxWidth: 560,
        }}
      >
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="photo" value={photo} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: "0.82rem", color: "#64748b" }}>Scan or paste item codes, one per line</span>
          <CameraScanButton onScan={(code) => { setText((t) => appendLine(t, code)); return cameraOutcome(code); }} />
        </div>
        <textarea
          name="scanned"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Scan items here. Each code on its own line."
          spellCheck={false}
          autoComplete="off"
          style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem", padding: 8, borderRadius: 6, border: "1px solid #cbd5e1" }}
        />
        {results.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2, fontSize: "0.82rem" }}>
            {results.map((r, i) => (
              <li key={`${r.code}-${i}`} style={{ color: r.state === "ok" ? "#166534" : r.state === "duplicate" ? "#64748b" : "#b3261e" }}>
                {r.state === "ok" ? "✓" : r.state === "duplicate" ? "•" : "✕"} <code>{r.id ?? r.code}</code>
                {r.state === "wrong" && ` — already ${STATUS_LABELS[r.status as Status] ?? r.status}`}
                {r.state === "unknown" && " — not found"}
                {r.state === "duplicate" && " — scanned twice, counted once"}
              </li>
            ))}
          </ul>
        )}
        {results.length > 0 && (
          <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
            {ready} unique · {duplicate} duplicate · {alreadyMarked} already {label}
          </span>
        )}
        <input
          name="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`Reason (required) — why ${label}`}
          required
          style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.95rem", minHeight: 40 }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", color: "#64748b" }}>
            Date {label === "lost" ? "lost" : "broken"}
            <input
              type="date"
              name="occurredAt"
              max={new Date().toISOString().slice(0, 10)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem", background: "#fff" }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", color: "#64748b" }}>
            City (where it happened)
            <select name="hub" defaultValue="" style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem", background: "#fff" }}>
              <option value="">Keep current hub</option>
              {cities.map(([city, cityHubs]) => (
                <optgroup key={city} label={city}>
                  {cityHubs.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", color: "#64748b" }}>
            Amount (₹)
            <input
              type="number"
              name="amount"
              min={0}
              placeholder="Item cost"
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.85rem", background: "#fff" }}
            />
          </label>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="lost-photo-file" style={{ fontSize: "0.72rem", color: "#64748b" }}>
            Photo or PDF *
          </label>
          <input
            id="lost-photo-file"
            type="file"
            accept="image/*,.pdf,application/pdf"
            required
            onChange={(e) => onPhotoFile(e.target.files?.[0])}
            style={{ fontSize: "0.85rem" }}
          />
          {photoBusy && <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b" }}>Preparing the file…</p>}
          {photoError && <p style={{ margin: 0, fontSize: "0.8rem", color: "#b3261e" }}>{photoError}</p>}
          {photo && isPdfPhoto && (
            <a href={photo} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.85rem" }}>
              📄 View attached PDF
            </a>
          )}
          {photo && !isPdfPhoto && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="Photo to attach" style={{ marginTop: 4, maxWidth: 200, borderRadius: 8, border: "1px solid #cbd5e1" }} />
          )}
          <p style={{ margin: 0, fontSize: "0.72rem", color: "#64748b" }}>
            Required — a photo or a PDF. If more than one item is scanned above, the same file is attached to
            each of them.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", color: "#64748b" }}>
            Role(s) (who had it)
            <details name="lost-report-filters" style={{ position: "relative" }}>
              <summary
                aria-label={`Role: ${roleSummary}`}
                style={{
                  listStyle: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 32,
                  padding: "6px 8px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  background: personRoles.length ? "#eef2ff" : "#fff",
                  color: "#1a1a1a",
                  fontSize: "0.85rem",
                  whiteSpace: "nowrap",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {roleSummary}
                <span aria-hidden="true" style={{ fontSize: 10, marginLeft: "auto" }}>▼</span>
              </summary>
              <div
                role="group"
                aria-label="Role(s)"
                style={{
                  position: "absolute",
                  zIndex: 20,
                  top: "calc(100% + 4px)",
                  left: 0,
                  minWidth: 180,
                  maxHeight: 280,
                  overflowY: "auto",
                  padding: 8,
                  background: "#fff",
                  color: "#1a1a1a",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                {ROLES.map((r) => (
                  <label
                    key={r}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minHeight: 30,
                      padding: "4px 6px",
                      borderRadius: 4,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      fontSize: "0.85rem",
                    }}
                  >
                    <input type="checkbox" checked={personRoles.includes(r)} onChange={() => toggleRole(r)} />
                    {ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
            </details>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", color: "#64748b" }}>
            Person(s) who had it
            <MultiSelect
              name="personIds"
              label="Person"
              allLabel="None chosen"
              options={peopleOptions}
              selected={[]}
              searchable
              group="lost-report-filters"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={ready === 0 || !photo}
          style={{
            alignSelf: "flex-start",
            fontSize: "0.85rem",
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #1e293b",
            background: ready === 0 || !photo ? "#94a3b8" : "#1e293b",
            borderColor: ready === 0 || !photo ? "#94a3b8" : "#1e293b",
            color: "#fff",
            cursor: ready === 0 || !photo ? "not-allowed" : "pointer",
          }}
        >
          Report {ready > 0 ? ready : ""} {label}
        </button>
        {ready > 0 && !photo && !photoBusy && <span style={{ fontSize: "0.8rem", color: "#64748b" }}>Add a photo to report.</span>}
      </form>
    </details>
  );
}
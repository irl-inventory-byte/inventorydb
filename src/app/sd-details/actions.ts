"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { displayName } from "@/lib/actors";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

type Team = "im" | "rig";

// The two Google Apps Script forms this data used to be entered into directly. Submissions are now
// saved to our own database first (the record this app actually reads back), and a copy is also
// POSTed here as a best effort — these endpoints are behind the organization's Google sign-in, so
// this could not be inspected directly; the field names below are a best guess from the form's
// visible labels. If the copy stops landing in the Google Sheet, the field names are the first thing
// to check (`forwarded` on the saved row records what happened, "yes" or "no: <reason>").
const FORWARD_URL: Record<Team, string> = {
  im: "https://script.google.com/a/macros/ailabs.instawork.com/s/AKfycbxv4qQ0v9OAM-Oo5e-cftWhK1mAKOFXPbaVY9hCQGDHL9JSBT55KKjE5F-Vjp3EGzKxGg/exec",
  rig: "https://script.google.com/a/macros/ailabs.instawork.com/s/AKfycbzHG48Yr4YgQrhnH-EhR0JFpLCw0Rh5bqUgoyG0AdOejbqDC8lOQ-VodXYPIgHzZD8J/exec",
};

async function forwardToScript(team: Team, fields: Record<string, string>): Promise<string> {
  try {
    const res = await fetch(FORWARD_URL[team], {
      method: "POST",
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok ? "yes" : `no: HTTP ${res.status}`;
  } catch (err) {
    return `no: ${err instanceof Error ? err.message : "failed"}`;
  }
}

/** Shared by both the IM and Rig team SD card details forms; `team` (a hidden field) tells them apart. */
export async function saveSdDetails(formData: FormData) {
  const user = await requireRole("admin", "im", "rig");

  const team: Team = String(formData.get("team") ?? "") === "rig" ? "rig" : "im";
  if (team === "im" && user.role !== "admin" && user.role !== "im") redirect("/?denied=1");
  if (team === "rig" && user.role !== "admin" && user.role !== "rig") redirect("/?denied=1");

  const back = (q: Record<string, string>) => redirect(`/sd-details/${team}?${new URLSearchParams(q)}`);

  const cardDate = String(formData.get("card_date") ?? "").trim();
  const teamMember = String(formData.get("team_member") ?? "").trim();
  const foIfo = String(formData.get("fo_ifo") ?? "").trim();
  const icName = String(formData.get("ic_name") ?? "").trim();
  const icNumber = String(formData.get("ic_number") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const serial = String(formData.get("serial") ?? "").trim();
  const duration = String(formData.get("duration") ?? "").trim();
  const failedHours = String(formData.get("failed_hours") ?? "").trim();
  const failedRawClips = String(formData.get("failed_raw_clips") ?? "").trim();
  const rawClips = String(formData.get("raw_clips") ?? "").trim();
  // Rig form only: not asked on the form anymore (removed per request) — every Rig-form entry is just
  // recorded as "Rig team". Still "" for IM entries. See sd-details/SdDetailsForm.tsx.
  const subTeam = team === "rig" ? "rig" : "";

  if (!cardDate || !teamMember || !icName || !city || !serial || !duration || !rawClips) {
    back({ error: "Fill in all the required fields." });
  }
  if (!icNumber.startsWith("IC-")) back({ error: "IC-Number must start with IC-." });
  if (!/^\d{1,2}:\d{2}:\d{2}$/.test(duration)) back({ error: "Duration must be in HH:MM:SS format, e.g. 01:30:45." });
  if (failedHours && !/^\d{1,2}:\d{2}:\d{2}$/.test(failedHours)) back({ error: "Failed hours must be in HH:MM:SS format, e.g. 00:15:00." });
  if (failedRawClips && !/^\d+$/.test(failedRawClips)) back({ error: "Failed clips must be a whole number." });

  const people = await getStore().list("people");
  const recordedByName = displayName(people, user.personId ?? "") || user.name || user.email || "";

  const recordId = `sdd-${randomUUID().slice(0, 8)}`;
  const rowToSave = {
    record_id: recordId,
    team,
    sub_team: subTeam,
    card_date: cardDate,
    team_member: teamMember,
    fo_ifo: foIfo,
    ic_name: icName,
    ic_number: icNumber,
    city,
    serial,
    duration,
    failed_hours: failedHours,
    failed_raw_clips: failedRawClips,
    raw_clips: rawClips,
    recorded_by: user.email ?? "unknown",
    recorded_by_name: recordedByName,
    recorded_at: istTimestamp(),
    forwarded: "",
  };
  await getStore().appendRows("sd_card_durations", [rowToSave]);

  const forwarded = await forwardToScript(team, {
    "SD CARD DATE": cardDate,
    [team === "im" ? "IM" : "RIG TEAM NAME"]: teamMember,
    ...(team === "rig" && { TEAM: "Rig team" }),
    "FO / IFO": foIfo,
    "IC NAME": icName,
    CITY: city,
    "IC-NUMBER": icNumber,
    "SD CARD SERIAL NUMBER / ASSET TAG": serial,
    DU_TIME: duration,
    FAILED_HOURS: failedHours,
    FAILED_RAW_CLIPS: failedRawClips,
    "NO. OF RAW CLIPS": rawClips,
  });
  // Send the WHOLE row back, not just {record_id, forwarded} — upsert() always writes every column of
  // the table, so a partial object here would blank out every other field on this row (that was the
  // original bug: the row looked right for a moment, then went blank once this ran).
  await getStore().upsert("sd_card_durations", [{ ...rowToSave, forwarded }]);

  back({ saved: "1" });
}

/**
 * Called from the SD card details form when the serial number field loses focus: looks up the most
 * recent prior submission for that same serial (across both IM and Rig forms) and returns the fields
 * that are safe to copy forward — FO/IFO, IC name, IC-Number, city, duration and raw clips — so the
 * form can pre-fill them. The person can still edit anything before submitting. Returns null when
 * there's no prior entry for that serial, so the form leaves everything as typed.
 */
export async function lookupSdDetailsBySerial(serial: string): Promise<{
  fo_ifo: string;
  ic_name: string;
  ic_number: string;
  city: string;
  duration: string;
  raw_clips: string;
} | null> {
  await requireRole("admin", "im", "rig");
  const s = serial.trim();
  if (!s) return null;

  const all = await getStore().list("sd_card_durations");
  const matches = all
    .filter((r) => r.serial.trim() === s)
    .sort((a, b) => Date.parse(b.recorded_at || "0") - Date.parse(a.recorded_at || "0"));
  const latest = matches[0];
  if (!latest) return null;

  return {
    fo_ifo: latest.fo_ifo || "",
    ic_name: latest.ic_name || "",
    ic_number: latest.ic_number || "",
    city: latest.city || "",
    duration: latest.duration || "",
    raw_clips: latest.raw_clips || "",
  };
}
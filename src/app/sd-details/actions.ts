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
  const rawClips = String(formData.get("raw_clips") ?? "").trim();
  // Rig form only: which hub actually sent this in — "Rig team" or "Productivity team" (same role,
  // two different hubs; see lib/rig-hub.ts). Not asked on the IM form, so always "" there.
  const subTeamRaw = String(formData.get("sub_team") ?? "").trim();
  const subTeam = team === "rig" ? (subTeamRaw === "productivity" ? "productivity" : "rig") : "";

  if (!cardDate || !teamMember || !icName || !city || !serial || !duration || !rawClips) {
    back({ error: "Fill in all the required fields." });
  }
  if (team === "rig" && subTeamRaw !== "rig" && subTeamRaw !== "productivity") {
    back({ error: "Choose Rig team or Productivity team." });
  }
  if (!icNumber.startsWith("IC-")) back({ error: "IC-Number must start with IC-." });
  if (!/^\d{1,2}:\d{2}:\d{2}$/.test(duration)) back({ error: "Duration must be in HH:MM:SS format, e.g. 01:30:45." });
  if (failedHours && !/^\d{1,2}:\d{2}:\d{2}$/.test(failedHours)) back({ error: "Failed hours must be in HH:MM:SS format, e.g. 00:15:00." });

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
    raw_clips: rawClips,
    recorded_by: user.email ?? "unknown",
    recorded_by_name: recordedByName,
    recorded_at: istTimestamp(),
    forwarded: "",
  };
  await getStore().appendRows("sd_card_durations", [rowToSave]);

  // TEMPORARY DIAGNOSTIC: some saved rows have come back with every field blank except record_id.
  // Read this row straight back and compare it to what was just sent — if anything didn't stick, say
  // so on screen (instead of "Saved.") with exactly which fields and what was sent, so the next
  // submission tells us precisely what's going wrong. Safe to remove once that's understood and fixed.
  const justSaved = (await getStore().list("sd_card_durations")).find((r) => r.record_id === recordId);
  const keys = Object.keys(rowToSave) as (keyof typeof rowToSave)[];
  const mismatches = justSaved
    ? keys.filter((k) => k !== "recorded_at" && String(justSaved[k] ?? "") !== String(rowToSave[k] ?? ""))
    : null;
  if (!justSaved) {
    back({ error: `DIAGNOSTIC: row ${recordId} was not found on readback right after saving it.` });
  }
  if (mismatches && mismatches.length) {
    back({
      error: `DIAGNOSTIC: these fields didn't save correctly — ${mismatches
        .map((k) => `${k}: sent "${rowToSave[k]}" but got back "${justSaved![k] ?? ""}"`)
        .join(" | ")}`,
    });
  }

  const forwarded = await forwardToScript(team, {
    "SD CARD DATE": cardDate,
    [team === "im" ? "IM" : "RIG TEAM NAME"]: teamMember,
    ...(team === "rig" && { TEAM: subTeam === "productivity" ? "Productivity team" : "Rig team" }),
    "FO / IFO": foIfo,
    "IC NAME": icName,
    CITY: city,
    "IC-NUMBER": icNumber,
    "SD CARD SERIAL NUMBER / ASSET TAG": serial,
    DU_TIME: duration,
    FAILED_HOURS: failedHours,
    "NO. OF RAW CLIPS": rawClips,
  });
  await getStore().upsert("sd_card_durations", [{ record_id: recordId, forwarded }]);

  back({ saved: "1" });
}
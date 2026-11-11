"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { displayName } from "@/lib/actors";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { istTimestamp } from "@/lib/time";

type Team = "im" | "rig";

// This used to also POST a copy of every submission to the IM/Rig team's old Google Apps Script form,
// so the Google Sheet stayed in sync with this app's own database. Per request, that forwarding has
// been removed entirely — this app's own database (sd_card_durations) is now the only place these
// entries are saved; nothing here writes to the Google Sheet anymore.

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
    forwarded: "n/a", // no longer forwarded anywhere — see note above
  };
  await getStore().appendRows("sd_card_durations", [rowToSave]);

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
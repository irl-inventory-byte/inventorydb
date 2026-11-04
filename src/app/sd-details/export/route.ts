import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { formatIst, istDate } from "@/lib/time";

const TEAM_NAME: Record<string, string> = { im: "IM", rig: "Rig team" };
const subTeamLabel = (r: { team: string; sub_team?: string }) =>
  r.team !== "rig" ? "" : r.sub_team === "productivity" ? "Productivity team" : "Rig team";

function csvCell(value: string): string {
  const text = value ?? "";
  // Quote anything a spreadsheet would otherwise split or misread.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Download the SD card details report as CSV, grouped city-wise then IC-wise (sorted by City, then
 * IC name) — same filters as the /sd-details page, so the file holds exactly what the page is
 * showing (every matching row, not just the page on screen):
 *   GET /sd-details/export?team=rig&subteam=productivity&city=…&member=…&from=…&to=…&q=…
 */
export async function GET(request: Request) {
  await requireRole("admin", "im", "rig");
  const params = new URL(request.url).searchParams;

  const teamFilter = params.get("team") ?? "";
  const subTeamFilter = params.get("subteam") ?? "";
  const cityFilter = params.get("city") ?? "";
  const memberFilter = params.get("member") ?? "";
  const dateFrom = params.get("from") ?? "";
  const dateTo = params.get("to") ?? "";
  const q = (params.get("q") ?? "").trim().toLowerCase();

  const all = await getStore().list("sd_card_durations");

  let rows = all;
  if (teamFilter) rows = rows.filter((r) => r.team === teamFilter);
  if (subTeamFilter) rows = rows.filter((r) => r.team === "rig" && (r.sub_team || "rig") === subTeamFilter);
  if (cityFilter) rows = rows.filter((r) => r.city === cityFilter);
  if (memberFilter) rows = rows.filter((r) => r.team_member === memberFilter);
  if (dateFrom) rows = rows.filter((r) => r.card_date >= dateFrom);
  if (dateTo) rows = rows.filter((r) => r.card_date <= dateTo);
  if (q) {
    rows = rows.filter((r) =>
      [r.ic_name, r.ic_number, r.serial, r.team_member, r.fo_ifo, r.city].some((v) => (v || "").toLowerCase().includes(q))
    );
  }

  // City-wise, then IC-wise: group the download the same way you'd read it on paper — every city's
  // cards together, and within a city every IC's cards together — rather than just submission order.
  rows = rows
    .slice()
    .sort(
      (a, b) =>
        (a.city || "").localeCompare(b.city || "") ||
        (a.ic_name || "").localeCompare(b.ic_name || "") ||
        a.card_date.localeCompare(b.card_date)
    );

  const header = [
    "City",
    "IC name",
    "IC number",
    "Date",
    "Team",
    "Team member",
    "FO / IFO",
    "Serial",
    "Duration",
    "Failed hours",
    "Raw clips",
    "Recorded by",
    "Submitted (IST)",
  ];
  const csvRows = [
    header,
    ...rows.map((r) => [
      r.city,
      r.ic_name,
      r.ic_number,
      r.card_date,
      r.team === "rig" ? subTeamLabel(r) : TEAM_NAME[r.team] ?? r.team,
      r.team_member,
      r.fo_ifo,
      r.serial,
      r.duration,
      r.failed_hours,
      r.raw_clips,
      r.recorded_by_name || r.recorded_by,
      r.recorded_at ? formatIst(r.recorded_at) : "",
    ]),
  ];
  const csv = csvRows.map((row) => row.map(csvCell).join(",")).join("\r\n");

  const span = dateFrom || dateTo ? `-${dateFrom || "start"}-to-${dateTo || "now"}` : "";
  const name = `SD-card-details-by-city-ic${span}-${istDate(new Date())}.csv`;

  // The BOM keeps Excel from mangling non-ASCII names.
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
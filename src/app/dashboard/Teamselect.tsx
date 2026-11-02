"use client";

/** Rig team / Productivity team picker for the dashboard tile — submits its form as soon as you pick, no "Go" button. */
export default function TeamSelect({
  team,
  rigLabel,
  prodLabel,
}: {
  team: "rig" | "productivity";
  rigLabel: string;
  prodLabel: string;
}) {
  return (
    <select
      name="team"
      defaultValue={team}
      onChange={(e) => e.currentTarget.form?.submit()}
      style={{ fontSize: "0.8rem", padding: "3px 6px", borderRadius: 6, border: "1px solid #cbd5e1", background: "#fff", color: "#334155" }}
    >
      <option value="rig">{rigLabel}</option>
      <option value="productivity">{prodLabel}</option>
    </select>
  );
}
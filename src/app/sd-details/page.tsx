import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { getStore } from "@/lib/store";
import { formatIst } from "@/lib/time";
import styles from "../admin/admin.module.css";

const TEAM_NAME: Record<string, string> = { im: "IM", rig: "Rig team" };

/**
 * SD CARD DETAILS: combined report of every "SD Card Duration Hour" entry saved by the IM and Rig
 * team forms (see sd-details/im, sd-details/rig, actions.ts). Admin, IM and the rig role (which
 * covers both the Rig team and the Productivity team) can all see everything here — unlike the two
 * entry forms, which only show each team their own recent entries.
 */
export default async function SdDetailsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "im", "rig");
  const sp = await searchParams;

  const teamFilter = one(sp.team); // "" (all), "im" or "rig"
  const cityFilter = one(sp.city);
  const q = one(sp.q).trim().toLowerCase();

  const all = await getStore().list("sd_card_durations");

  const byTeam = (["im", "rig"] as const).map((team) => ({
    team,
    label: TEAM_NAME[team],
    count: all.filter((r) => r.team === team).length,
  }));

  const cities = [...new Set(all.map((r) => r.city).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  // City-wise matrix: total / IM / Rig counts per city, always over the full set (not the active filters).
  const cityMatrix = cities
    .map((city) => {
      const cityRows = all.filter((r) => r.city === city);
      return {
        city,
        total: cityRows.length,
        im: cityRows.filter((r) => r.team === "im").length,
        rig: cityRows.filter((r) => r.team === "rig").length,
      };
    })
    .sort((a, b) => b.total - a.total);

  let rows = all;
  if (teamFilter) rows = rows.filter((r) => r.team === teamFilter);
  if (cityFilter) rows = rows.filter((r) => r.city === cityFilter);
  if (q) {
    rows = rows.filter((r) =>
      [r.ic_name, r.ic_number, r.serial, r.team_member, r.fo_ifo, r.city]
        .some((v) => (v || "").toLowerCase().includes(q))
    );
  }
  rows = rows.slice().sort((a, b) => Date.parse(b.recorded_at || "0") - Date.parse(a.recorded_at || "0"));

  // Matrix: total, this week, not-forwarded (flags a row whose copy to the Google Sheet failed).
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = all.filter((r) => Date.parse(r.recorded_at || "0") >= weekAgo).length;
  const notForwarded = all.filter((r) => r.forwarded && r.forwarded !== "yes").length;

  const keep = (extra: Record<string, string>) =>
    `/sd-details?${new URLSearchParams({
      ...(teamFilter && { team: teamFilter }),
      ...(cityFilter && { city: cityFilter }),
      ...(q && { q }),
      ...extra,
    })}`;

  const chip = (on: boolean) => ({
    padding: "6px 14px",
    borderRadius: 999,
    border: "1px solid #cbd5e1",
    background: on ? "#1e293b" : "#ffffff",
    color: on ? "#ffffff" : "#334155",
    textDecoration: "none",
    fontWeight: on ? 700 : 500,
    fontSize: "0.9rem",
  });

  const card = { flex: "1 1 160px", padding: "12px 16px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#f8fafc" };
  const cardValue = { fontSize: "1.6rem", fontWeight: 700, color: "#1e293b", lineHeight: 1.1 };
  const cardLabel = { fontSize: "0.8rem", color: "#64748b", marginTop: 2 };

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link>
      </p>
      <h1>SD card details ({all.length})</h1>
      <p className={styles.muted}>Every SD Card Duration Hour entry — saved here and also sent to the Google Sheet.</p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0 18px" }}>
        <div style={card}>
          <div style={cardValue}>{all.length}</div>
          <div style={cardLabel}>Total entries</div>
        </div>
        <div style={card}>
          <div style={cardValue}>{thisWeek}</div>
          <div style={cardLabel}>This week</div>
        </div>
        {byTeam.map((t) => (
          <div key={t.team} style={card}>
            <div style={cardValue}>{t.count}</div>
            <div style={cardLabel}>{t.label}</div>
          </div>
        ))}
        <div style={card}>
          <div style={{ ...cardValue, color: notForwarded > 0 ? "#b91c1c" : cardValue.color }}>{notForwarded}</div>
          <div style={cardLabel}>Not sent to Google Sheet</div>
        </div>
      </div>

      {cityMatrix.length > 0 && (
        <div style={{ margin: "0 0 18px" }}>
          <h2 style={{ fontSize: "1rem", margin: "0 0 8px" }}>By city</h2>
          <div role="region" aria-label="By city" tabIndex={0} style={{ overflowX: "auto" }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>City</th>
                  <th>Total</th>
                  <th>IM</th>
                  <th>Rig team</th>
                </tr>
              </thead>
              <tbody>
                {cityMatrix.map((c) => (
                  <tr key={c.city}>
                    <td>
                      <Link href={keep({ city: c.city })}>{c.city}</Link>
                    </td>
                    <td>{c.total}</td>
                    <td>{c.im}</td>
                    <td>{c.rig}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <nav aria-label="Filter by team" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "4px 0 10px" }}>
        <Link href={keep({ team: "" })} aria-current={!teamFilter ? "true" : undefined} style={chip(!teamFilter)}>
          All · {all.length}
        </Link>
        {byTeam.map((t) => (
          <Link key={t.team} href={keep({ team: t.team })} aria-current={t.team === teamFilter ? "true" : undefined} style={chip(t.team === teamFilter)}>
            {t.label} · {t.count}
          </Link>
        ))}
      </nav>

      {cities.length > 0 && (
        <nav aria-label="Filter by city" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 14px" }}>
          <Link href={keep({ city: "" })} aria-current={!cityFilter ? "true" : undefined} style={chip(!cityFilter)}>
            All cities
          </Link>
          {cities.map((c) => (
            <Link key={c} href={keep({ city: c })} aria-current={c === cityFilter ? "true" : undefined} style={chip(c === cityFilter)}>
              {c}
            </Link>
          ))}
        </nav>
      )}

      <form className={styles.row} method="get" style={{ margin: "0 0 16px" }}>
        {teamFilter && <input type="hidden" name="team" value={teamFilter} />}
        {cityFilter && <input type="hidden" name="city" value={cityFilter} />}
        <input name="q" defaultValue={one(sp.q)} placeholder="Search IC name, IC number, serial, team member or FO/IFO" aria-label="Search entries" />
        <button type="submit">Search</button>
        {(teamFilter || cityFilter || q) && <Link href="/sd-details">Clear all</Link>}
      </form>

      {rows.length === 0 ? (
        <p className={styles.muted}>No entries match.</p>
      ) : (
        <div role="region" aria-label="SD card details" tabIndex={0} style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Team</th>
                <th>Team member</th>
                <th>FO / IFO</th>
                <th>IC</th>
                <th>City</th>
                <th>Serial</th>
                <th>Duration</th>
                <th>Clips</th>
                <th>Recorded by</th>
                <th>Submitted</th>
                <th>Sent to sheet</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.record_id}>
                  <td>{r.card_date}</td>
                  <td>{TEAM_NAME[r.team] ?? r.team}</td>
                  <td>{r.team_member}</td>
                  <td>{r.fo_ifo || "—"}</td>
                  <td>
                    {r.ic_name} {r.ic_number && `(${r.ic_number})`}
                  </td>
                  <td>{r.city}</td>
                  <td>{r.serial}</td>
                  <td>{r.duration}</td>
                  <td>{r.raw_clips}</td>
                  <td>{r.recorded_by_name || r.recorded_by || "—"}</td>
                  <td>{r.recorded_at ? formatIst(r.recorded_at) : "—"}</td>
                  <td style={{ color: r.forwarded === "yes" ? "#166534" : r.forwarded ? "#b91c1c" : "#64748b" }}>
                    {r.forwarded === "yes" ? "Yes" : r.forwarded ? "No" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
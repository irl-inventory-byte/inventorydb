import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { getStore } from "@/lib/store";
import { formatIst } from "@/lib/time";
import styles from "../admin/admin.module.css";

const TEAM_NAME: Record<string, string> = { im: "IM", rig: "Rig team" };
// For rig-team rows, which hub actually sent it in — "Rig team" or "Productivity team" (same role,
// two hubs). Blank sub_team on an older rig row (saved before this field existed) falls back to "Rig team".
const subTeamLabel = (r: { team: string; sub_team?: string }) =>
  r.team !== "rig" ? "" : r.sub_team === "productivity" ? "Productivity team" : "Rig team";

/**
 * SD CARD DETAILS: combined report of every "SD Card Duration Hour" entry saved by the IM and Rig
 * team forms (see sd-details/im, sd-details/rig, actions.ts). Admin, IM and the rig role (which
 * covers both the Rig team and the Productivity team) can all see everything here — unlike the two
 * entry forms, which only show each team their own recent entries. Also reachable from the Dashboard
 * (see dashboard/page.tsx), not just the home page.
 */
export default async function SdDetailsPage({ searchParams }: PageProps<"/sd-details">) {
  await requireRole("admin", "im", "rig");
  const sp = await searchParams;

  const teamFilter = one(sp.team); // "" (all), "im" or "rig"
  const subTeamFilter = one(sp.subteam); // "" (all), "rig" or "productivity" — only meaningful within team=rig
  const cityFilter = one(sp.city);
  const memberFilter = one(sp.member); // team member name
  const dateFrom = one(sp.from); // "YYYY-MM-DD", filters by card_date
  const dateTo = one(sp.to); // "YYYY-MM-DD", filters by card_date
  const q = one(sp.q).trim().toLowerCase();

  const all = await getStore().list("sd_card_durations");

  const byTeam = (["im", "rig"] as const).map((team) => ({
    team,
    label: TEAM_NAME[team],
    count: all.filter((r) => r.team === team).length,
  }));

  const cities = [...new Set(all.map((r) => r.city).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const members = [...new Set(all.map((r) => r.team_member).filter(Boolean))].sort((a, b) => a.localeCompare(b));

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
  if (subTeamFilter) rows = rows.filter((r) => r.team === "rig" && (r.sub_team || "rig") === subTeamFilter);
  if (cityFilter) rows = rows.filter((r) => r.city === cityFilter);
  if (memberFilter) rows = rows.filter((r) => r.team_member === memberFilter);
  if (dateFrom) rows = rows.filter((r) => r.card_date >= dateFrom);
  if (dateTo) rows = rows.filter((r) => r.card_date <= dateTo);
  if (q) {
    rows = rows.filter((r) =>
      [r.ic_name, r.ic_number, r.serial, r.team_member, r.fo_ifo, r.city]
        .some((v) => (v || "").toLowerCase().includes(q))
    );
  }
  rows = rows.slice().sort((a, b) => Date.parse(b.recorded_at || "0") - Date.parse(a.recorded_at || "0"));

  // Matrix: total and this week, over the full set.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = all.filter((r) => Date.parse(r.recorded_at || "0") >= weekAgo).length;

  const keep = (extra: Record<string, string>) =>
    `/sd-details?${new URLSearchParams({
      ...(teamFilter && { team: teamFilter }),
      ...(subTeamFilter && { subteam: subTeamFilter }),
      ...(cityFilter && { city: cityFilter }),
      ...(memberFilter && { member: memberFilter }),
      ...(dateFrom && { from: dateFrom }),
      ...(dateTo && { to: dateTo }),
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

  const hasFilters = teamFilter || subTeamFilter || cityFilter || memberFilter || dateFrom || dateTo || q;
  // Same filters as the page, download instead of /sd-details/export — city-wise, then IC-wise.
  const exportHref = `/sd-details/export?${new URLSearchParams({
    ...(teamFilter && { team: teamFilter }),
    ...(subTeamFilter && { subteam: subTeamFilter }),
    ...(cityFilter && { city: cityFilter }),
    ...(memberFilter && { member: memberFilter }),
    ...(dateFrom && { from: dateFrom }),
    ...(dateTo && { to: dateTo }),
    ...(q && { q }),
  })}`;

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link> · <Link href="/dashboard">Dashboard</Link>
      </p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>SD card details ({all.length})</h1>
        <a
          href={exportHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #1e293b",
            background: "#1e293b",
            color: "#fff",
            fontWeight: 600,
            fontSize: "0.88rem",
            textDecoration: "none",
          }}
        >
          Download CSV (city &amp; IC-wise)
        </a>
      </div>
      <p className={styles.muted}>
        Every SD Card Duration Hour entry — saved here and also sent to the Google Sheet. The download uses
        whichever filters are active below.
      </p>

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
          <Link key={t.team} href={keep({ team: t.team, subteam: "" })} aria-current={t.team === teamFilter ? "true" : undefined} style={chip(t.team === teamFilter)}>
            {t.label} · {t.count}
          </Link>
        ))}
      </nav>

      {teamFilter === "rig" && (
        <nav aria-label="Filter by rig sub-team" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 10px" }}>
          <Link href={keep({ subteam: "" })} aria-current={!subTeamFilter ? "true" : undefined} style={chip(!subTeamFilter)}>
            Rig + Productivity
          </Link>
          <Link href={keep({ subteam: "rig" })} aria-current={subTeamFilter === "rig" ? "true" : undefined} style={chip(subTeamFilter === "rig")}>
            Rig team
          </Link>
          <Link href={keep({ subteam: "productivity" })} aria-current={subTeamFilter === "productivity" ? "true" : undefined} style={chip(subTeamFilter === "productivity")}>
            Productivity team
          </Link>
        </nav>
      )}

      {cities.length > 0 && (
        <nav aria-label="Filter by city" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 10px" }}>
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

      <form className={styles.row} method="get" style={{ margin: "0 0 10px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {teamFilter && <input type="hidden" name="team" value={teamFilter} />}
        {subTeamFilter && <input type="hidden" name="subteam" value={subTeamFilter} />}
        {cityFilter && <input type="hidden" name="city" value={cityFilter} />}
        {q && <input type="hidden" name="q" value={one(sp.q)} />}
        <label style={{ fontSize: "0.85rem", color: "#334155" }}>
          Team member{" "}
          <select name="member" defaultValue={memberFilter}>
            <option value="">All</option>
            {members.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>

      <form className={styles.row} method="get" style={{ margin: "0 0 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {teamFilter && <input type="hidden" name="team" value={teamFilter} />}
        {subTeamFilter && <input type="hidden" name="subteam" value={subTeamFilter} />}
        {cityFilter && <input type="hidden" name="city" value={cityFilter} />}
        {memberFilter && <input type="hidden" name="member" value={memberFilter} />}
        <label style={{ fontSize: "0.85rem", color: "#334155" }}>
          Date from <input type="date" name="from" defaultValue={dateFrom} aria-label="Date from" />
        </label>
        <label style={{ fontSize: "0.85rem", color: "#334155" }}>
          to <input type="date" name="to" defaultValue={dateTo} aria-label="Date to" />
        </label>
        <button type="submit">Filter by date</button>
      </form>

      <form className={styles.row} method="get" style={{ margin: "0 0 16px" }}>
        {teamFilter && <input type="hidden" name="team" value={teamFilter} />}
        {subTeamFilter && <input type="hidden" name="subteam" value={subTeamFilter} />}
        {cityFilter && <input type="hidden" name="city" value={cityFilter} />}
        {memberFilter && <input type="hidden" name="member" value={memberFilter} />}
        {dateFrom && <input type="hidden" name="from" value={dateFrom} />}
        {dateTo && <input type="hidden" name="to" value={dateTo} />}
        <input name="q" defaultValue={one(sp.q)} placeholder="Search IC name, IC number, serial, team member or FO/IFO" aria-label="Search entries" />
        <button type="submit">Search</button>
        {hasFilters && <Link href="/sd-details">Clear all</Link>}
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
                <th>Failed</th>
                <th>Clips</th>
                <th>Recorded by</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.record_id}>
                  <td>{r.card_date}</td>
                  <td>{r.team === "rig" ? subTeamLabel(r) : TEAM_NAME[r.team] ?? r.team}</td>
                  <td>{r.team_member}</td>
                  <td>{r.fo_ifo || "—"}</td>
                  <td>
                    {r.ic_name} {r.ic_number && `(${r.ic_number})`}
                  </td>
                  <td>{r.city}</td>
                  <td>{r.serial}</td>
                  <td>{r.duration}</td>
                  <td>{r.failed_hours || "—"}</td>
                  <td>{r.raw_clips}</td>
                  <td>{r.recorded_by_name || r.recorded_by || "—"}</td>
                  <td>{r.recorded_at ? formatIst(r.recorded_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
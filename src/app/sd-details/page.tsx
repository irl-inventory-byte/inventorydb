import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { one } from "@/lib/labels";
import { getStore } from "@/lib/store";
import { formatHms, sumHms } from "@/lib/duration";
import { formatIst, istDate } from "@/lib/time";
import styles from "../admin/admin.module.css";
import BackLink from "../BackLink";

type SdDetailsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

const TEAM_NAME: Record<string, string> = { im: "IM", rig: "Productivity team" };
// Rig-team rows are all shown under one label now ("Productivity team") — the old separate
// "Rig team" / "Productivity team" split by sub_team is no longer shown anywhere on this page.
const subTeamLabel = (r: { team: string; sub_team?: string }) => (r.team !== "rig" ? "" : "Productivity team");

/**
 * SD CARD DETAILS: combined report of every "SD Card Duration Hour" entry saved by the IM and Rig
 * team forms (see sd-details/im, sd-details/rig, actions.ts). Admin, IM and the rig role (which
 * covers both the Rig team and the Productivity team) can all see everything here — unlike the two
 * entry forms, which only show each team their own recent entries. Also reachable from the Dashboard
 * (see dashboard/page.tsx), not just the home page.
 */
export default async function SdDetailsPage({ searchParams }: SdDetailsPageProps) {
  await requireRole("admin", "im", "rig");
  const sp = (await searchParams) ?? {};

  // Hours-by-city date range (separate from the "Date from / to" filter further down, which filters the
  // row table at the bottom). Shows IM Hours and Rig team Hours (every "SD Card Duration Hour" entry in
  // that range for that team), split out by city, and narrowed to one city when the city filter below
  // is set. Nothing filtered at all (no ?hfrom/?hto/?city in the URL) → every entry ever logged, by
  // city, instead of just today (which was usually empty) — this is what used to be the "By city" table.
  // City can now be more than one at once — the "City" box below is a multi-select, so ?city= can
  // appear several times in the URL.
  const many = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);
  const cityFilters = many(sp.city).filter(Boolean);
  const cityFilter = cityFilters[0] ?? ""; // kept for the single-city "Filter by city" quick links below

  const hFiltered = Boolean(one(sp.hfrom) || one(sp.hto) || cityFilters.length);
  const hFrom = one(sp.hfrom) || istDate(new Date());
  const hTo = one(sp.hto) || istDate(new Date());

  const teamFilter = one(sp.team); // "" (all), "im" or "rig"
  const subTeamFilter = one(sp.subteam); // "" (all), "rig" or "productivity" — only meaningful within team=rig
  const icFilter = one(sp.ic); // IC name
  const memberFilter = one(sp.member); // team member name
  const dateFrom = one(sp.from); // "YYYY-MM-DD", filters by card_date
  const dateTo = one(sp.to); // "YYYY-MM-DD", filters by card_date
  const q = one(sp.q).trim().toLowerCase();

  const all = await getStore().list("sd_card_durations");

  // IM and the rig/productivity team, as their own cards. The old separate "Rig team" / "Productivity
  // team" split by sub_team is no longer shown — both are just "Productivity team" here.
  const byTeam = [
    { team: "im" as const, subteam: "", label: TEAM_NAME.im, count: all.filter((r) => r.team === "im").length },
    { team: "rig" as const, subteam: "", label: "Productivity team", count: all.filter((r) => r.team === "rig").length },
  ];

  // A handful of old entries have "Rig team" saved in the city field itself (bad data, not a real
  // city) — that was showing up as its own row in the city dropdown and in the Hours-by-city tables
  // (including Overall, which was then a card or two too high). Drop it everywhere cities are listed.
  const cities = [...new Set(all.map((r) => r.city).filter(Boolean))]
    .filter((c) => c.trim().toLowerCase() !== "rig team")
    .sort((a, b) => a.localeCompare(b));
  const ics = [...new Set(all.map((r) => r.ic_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const members = [...new Set(all.map((r) => r.team_member).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  // Hours by city: IM Hours and Rig team Hours — every entry for that team (and, if chosen, that
  // city), narrowed to the date range only once one's actually been set (see hFiltered above).
  const dayRows = (hFiltered ? all.filter((r) => r.card_date >= hFrom && r.card_date <= hTo) : all).filter(
    (r) => cityFilters.length === 0 || cityFilters.includes(r.city),
  );
  const hoursByCity = (rowsForRange: typeof dayRows) =>
    cities
      .map((city) => {
        const cityRows = rowsForRange.filter((r) => r.city === city);
        // Total SD cards: one entry = one SD card logged for that city, so this is just the row count —
        // same number already used as rowCount below, named for what it means in the table.
        const cardCount = cityRows.length;
        // Total clips: raw_clips summed across this range's entries for that city. It's a free-text number
        // field (see schema.ts), so non-numeric/blank values are treated as 0 rather than breaking the sum.
        const clipsTotal = cityRows.reduce((sum, r) => sum + (Number(r.raw_clips) || 0), 0);
        return { city, cardCount, clipsTotal, seconds: sumHms(cityRows.map((r) => r.duration)), rowCount: cityRows.length };
      })
      .filter((c) => c.rowCount > 0)
      .sort((a, b) => b.cardCount - a.cardCount);

  const imHoursByCity = hoursByCity(dayRows.filter((r) => r.team === "im"));
  const rigHoursByCity = hoursByCity(dayRows.filter((r) => r.team === "rig"));
  // Overall: Productivity team only (same rows as "Productivity team Hours" above), not IM+Productivity
  // combined — per request.
  const overallByCity = rigHoursByCity;

  let rows = all;
  if (teamFilter) rows = rows.filter((r) => r.team === teamFilter);
  if (subTeamFilter) rows = rows.filter((r) => r.team === "rig" && (r.sub_team || "rig") === subTeamFilter);
  if (cityFilters.length) rows = rows.filter((r) => cityFilters.includes(r.city));
  if (icFilter) rows = rows.filter((r) => r.ic_name === icFilter);
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

  // extra.city, when given, replaces the whole city selection (used by the single-city quick links
  // below); every other key is a plain single value as before.
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (hFrom) p.set("hfrom", hFrom);
    if (hTo) p.set("hto", hTo);
    if (teamFilter) p.set("team", teamFilter);
    if (subTeamFilter) p.set("subteam", subTeamFilter);
    if ("city" in extra) {
      if (extra.city) p.set("city", extra.city);
    } else {
      cityFilters.forEach((c) => p.append("city", c));
    }
    if (icFilter) p.set("ic", icFilter);
    if (memberFilter) p.set("member", memberFilter);
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(extra)) {
      if (k === "city") continue;
      if (v) p.set(k, v);
      else p.delete(k);
    }
    return `/sd-details?${p.toString()}`;
  };

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

  const hasFilters = teamFilter || subTeamFilter || cityFilters.length || icFilter || memberFilter || dateFrom || dateTo || q;
  // Same filters as the page, download instead of /sd-details/export — city-wise, then IC-wise.
  const exportParams = new URLSearchParams();
  if (teamFilter) exportParams.set("team", teamFilter);
  if (subTeamFilter) exportParams.set("subteam", subTeamFilter);
  cityFilters.forEach((c) => exportParams.append("city", c));
  if (icFilter) exportParams.set("ic", icFilter);
  if (memberFilter) exportParams.set("member", memberFilter);
  if (dateFrom) exportParams.set("from", dateFrom);
  if (dateTo) exportParams.set("to", dateTo);
  if (q) exportParams.set("q", q);
  const exportHref = `/sd-details/export?${exportParams.toString()}`;

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <BackLink /> · <Link href="/dashboard">Dashboard</Link>
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
          <div key={`${t.team}-${t.subteam}`} style={card}>
            <div style={cardValue}>{t.count}</div>
            <div style={cardLabel}>{t.label}</div>
          </div>
        ))}
      </div>

      <div style={{ margin: "0 0 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 10px" }}>
          <h2 style={{ fontSize: "1rem", margin: 0 }}>Hours by city</h2>
          <form method="get" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {teamFilter && <input type="hidden" name="team" value={teamFilter} />}
            {subTeamFilter && <input type="hidden" name="subteam" value={subTeamFilter} />}
            <label style={{ fontSize: "0.85rem", color: "#334155" }}>
              From <input type="date" name="hfrom" defaultValue={hFiltered ? hFrom : ""} aria-label="From date" />
            </label>
            <label style={{ fontSize: "0.85rem", color: "#334155" }}>
              To <input type="date" name="hto" defaultValue={hFiltered ? hTo : ""} aria-label="To date" />
            </label>
            <select name="city" defaultValue={cityFilter} aria-label="City">
              <option value="">All cities</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="submit">Go</button>
          </form>
          <span style={{ fontSize: "0.85rem", color: "#64748b" }}>
            {hFiltered ? (hFrom === hTo ? hFrom : `${hFrom} to ${hTo}`) : "All time"}
            {cityFilters.length > 0 && ` · ${cityFilters.join(", ")}`}
          </span>
        </div>

        {[
          { title: "IM Hours", data: imHoursByCity },
          { title: "Productivity team Hours", data: rigHoursByCity },
          { title: "Overall", data: overallByCity },
        ].map(({ title, data }) => (
          <div key={title} style={{ margin: "0 0 14px" }}>
            <h3 style={{ fontSize: "0.9rem", margin: "0 0 6px", color: "#334155" }}>{title}</h3>
            {data.length === 0 ? (
              <p className={styles.muted} style={{ margin: "0 0 6px" }}>
                {hFiltered ? "No entries for this range." : "No entries."}
              </p>
            ) : (
              <div role="region" aria-label={title} tabIndex={0} style={{ overflowX: "auto" }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>City</th>
                      <th>Total SD cards</th>
                      <th>Total clips</th>
                      <th>Total hrs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((c) => (
                      <tr key={c.city}>
                        <td>{c.city}</td>
                        <td>{c.cardCount}</td>
                        <td>{c.clipsTotal}</td>
                        <td>{formatHms(c.seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      <nav aria-label="Filter by team" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "4px 0 10px" }}>
        <Link href={keep({ team: "" })} aria-current={!teamFilter ? "true" : undefined} style={chip(!teamFilter)}>
          All · {all.length}
        </Link>
        {byTeam.map((t) => {
          const on = t.team === teamFilter && (t.subteam || "") === subTeamFilter;
          return (
            <Link key={`${t.team}-${t.subteam}`} href={keep({ team: t.team, subteam: t.subteam })} aria-current={on ? "true" : undefined} style={chip(on)}>
              {t.label} · {t.count}
            </Link>
          );
        })}
      </nav>

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
        {cityFilters.map((c) => (
          <input key={c} type="hidden" name="city" value={c} />
        ))}
        {q && <input type="hidden" name="q" value={one(sp.q)} />}
        <label style={{ fontSize: "0.85rem", color: "#334155" }}>
          IC{" "}
          <select name="ic" defaultValue={icFilter}>
            <option value="">All</option>
            {ics.map((ic) => (
              <option key={ic} value={ic}>
                {ic}
              </option>
            ))}
          </select>
        </label>
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
        {cityFilters.map((c) => (
          <input key={c} type="hidden" name="city" value={c} />
        ))}
        {icFilter && <input type="hidden" name="ic" value={icFilter} />}
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
        {cityFilters.map((c) => (
          <input key={c} type="hidden" name="city" value={c} />
        ))}
        {icFilter && <input type="hidden" name="ic" value={icFilter} />}
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
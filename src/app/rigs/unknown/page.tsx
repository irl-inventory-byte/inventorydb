import Link from "next/link";
import { displayName } from "@/lib/actors";
import { storeFor } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import { inactiveRigs } from "@/lib/rig-metrics";
import { getStore } from "@/lib/store";
import { formatIst } from "@/lib/time";
import { NO_ACTIVITY_DAYS } from "../../dashboard/rig-metrics";
import styles from "../../admin/admin.module.css";
import ReportForm from "./ReportForm";

const card = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff" } as const;

/**
 * RIG AUDIT (was "Unknown rigs"): rigs with no handover, QC result or hardware update for more than NO_ACTIVITY_DAYS days
 * (rigs with hardware, dead, R&D, lost or damaged are left out). Admin, IM and Hardware team.
 * Click a rig to see who reported it, where it is, why, with a photo, and to add a new report.
 */
export default async function UnknownRigsPage({ searchParams }: PageProps<"/">) {
  const user = await requireRole("admin", "im", "hardware", "qc");
  const sp = await searchParams;
  const q = one(sp.q).trim().toLowerCase();
  const rigId = one(sp.rig);

  const store = storeFor(user.role, "rig");
  const [rigs, events, people, hubs, qcChecks, hardware, reports] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("people"),
    store.list("hubs"),
    store.list("qc_checks"),
    store.list("hardware_updates"),
    getStore().list("rig_reports"),
  ]);
  const now = new Date();
  const unknown = inactiveRigs(rigs, events, qcChecks, hardware, now, NO_ACTIVITY_DAYS);

  const byId = new Map(rigs.map((r) => [r.item_id, r]));
  const hubName = new Map(hubs.map((h) => [h.hub_id, h.name]));
  const hubCity = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));
  const reportsOf = (id: string) => reports.filter((r) => r.item_id === id).reverse(); // newest first

  const shown = unknown.filter((u) => {
    if (!q) return true;
    const r = byId.get(u.item_id);
    const where = [displayName(people, u.holder), hubName.get(r?.current_hub ?? ""), hubCity.get(r?.current_hub ?? "")];
    return [u.item_id, r?.prism_no, r?.brand, r?.model, ...where].some((v) => (v ?? "").toLowerCase().includes(q));
  });

  const rig = rigId ? byId.get(rigId) : undefined;
  const rigUnknown = rig ? unknown.find((u) => u.item_id === rig.item_id) : undefined;
  const rigReports = rig ? reportsOf(rig.item_id) : [];
  const keep = (extra: Record<string, string>) => `/rigs/unknown?${new URLSearchParams({ ...(q && { q }), ...extra })}`;
  const me = displayName(people, user.personId ?? "") || user.name || user.email || "You";

  return (
    <main className={styles.pageWide}>
      <p className={styles.back}>
        <Link href="/">← Home</Link> · <Link href="/dashboard?type=rig">Rig dashboard</Link>
      </p>
      <h1>Rig Audit ({unknown.length})</h1>
      <p className={styles.muted}>
        Rigs with no handover, QC result or hardware update for more than {NO_ACTIVITY_DAYS} days. Rigs with the
        hardware team, dead, R&amp;D, lost or damaged are not counted. Click a rig to see its reports (who, where, why,
        photo) or to add an audit report. Location, role, person, reason and photo are required.
      </p>

      {rig && (
        <section id="report" style={{ ...card, display: "grid", gap: 14, scrollMarginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
            <h2 style={{ margin: 0 }}>
              Rig {rig.item_id}
              {[rig.brand, rig.model].filter(Boolean).length > 0 && (
                <span className={styles.muted} style={{ fontWeight: 400 }}> · {[rig.brand, rig.model].filter(Boolean).join(" ")}</span>
              )}
            </h2>
            <Link href={`${keep({})}#list`}>Close</Link>
          </div>

          {one(sp.saved) === "1" && <p className={styles.ok}>Report saved.</p>}
          {one(sp.error) && <p className={styles.error}>{one(sp.error)}</p>}

          <dl className={styles.facts}>
            <dt>Status</dt>
            <dd style={{ margin: 0 }}>{STATUS_LABELS[rig.status] ?? rig.status}</dd>
            <dt>Last with</dt>
            <dd style={{ margin: 0 }}>{displayName(people, rig.current_holder) || "—"}</dd>
            <dt>Hub · City</dt>
            <dd style={{ margin: 0 }}>
              {hubName.get(rig.current_hub) ?? (rig.current_hub || "—")} · {hubCity.get(rig.current_hub) ?? "—"}
            </dd>
            <dt>Last activity</dt>
            <dd style={{ margin: 0 }}>
              {rigUnknown ? `${formatIst(rigUnknown.lastActivity)} · ${rigUnknown.days} days ago` : "Recent (not unknown now)"}
            </dd>
            <dt>Full history</dt>
            <dd style={{ margin: 0 }}>
              <Link href={`/inventory/${encodeURIComponent(rig.item_id)}`}>Open in Inventory</Link>
            </dd>
          </dl>

          <div>
            <h3 style={{ margin: "4px 0 8px" }}>Reports ({rigReports.length})</h3>
            {rigReports.length === 0 ? (
              <p className={styles.muted}>No reports yet. Add the first one below.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {rigReports.map((r) => (
                  <article
                    key={r.report_id}
                    style={{ display: "flex", gap: 14, flexWrap: "wrap", border: "1px solid #eef0f3", borderRadius: 10, padding: 12 }}
                  >
                    {r.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.photo}
                        alt={`Photo of rig ${rig.item_id}`}
                        style={{ width: 180, maxWidth: "100%", height: "auto", borderRadius: 8, border: "1px solid #e5e7eb", objectFit: "cover" }}
                      />
                    ) : (
                      <div
                        style={{ width: 180, height: 120, borderRadius: 8, background: "#f3f4f6", display: "grid", placeItems: "center", color: "#6b7280", fontSize: "0.85rem" }}
                      >
                        No photo
                      </div>
                    )}
                    <dl className={styles.facts} style={{ flex: "1 1 260px", alignContent: "start" }}>
                      <dt>Login person</dt>
                      <dd style={{ margin: 0 }}>
                        <b>{r.recorded_by_name || r.recorded_by}</b>
                        {r.recorded_by_name && r.recorded_by && r.recorded_by_name !== r.recorded_by ? (
                          <span className={styles.muted}> · {r.recorded_by}</span>
                        ) : null}
                      </dd>
                      <dt>Location</dt>
                      <dd style={{ margin: 0 }}>
                        {r.location || "—"}
                        {r.hub_id && hubCity.get(r.hub_id) && hubCity.get(r.hub_id) !== r.location ? ` · ${hubCity.get(r.hub_id)}` : ""}
                      </dd>
                      <dt>With (person)</dt>
                      <dd style={{ margin: 0 }}>
                        {r.person_name || "—"}
                        {r.role ? <span className={styles.muted}> · {ROLE_LABELS[r.role as keyof typeof ROLE_LABELS] ?? r.role}</span> : null}
                      </dd>
                      <dt>Reason</dt>
                      <dd style={{ margin: 0, whiteSpace: "pre-wrap" }}>{r.reason || "—"}</dd>
                      <dt>When</dt>
                      <dd style={{ margin: 0 }}>{formatIst(r.recorded_at)}</dd>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 style={{ margin: "4px 0 8px" }}>Add an audit report</h3>
            <ReportForm
              rig={rig.item_id}
              who={me}
              defaultHub={rig.current_hub}
              hubs={hubs
                .filter((h) => h.active !== "false")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((h) => ({ id: h.hub_id, name: h.name, city: (h.city || "").trim() }))}
              people={people
                .filter((p) => p.active !== "false")
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((p) => ({ id: p.person_id, name: p.name, role: p.role, hub: p.hub }))}
            />
          </div>
        </section>
      )}
      {rigId && !rig && <p className={styles.error}>Rig {rigId} was not found.</p>}

      <form className={styles.row} method="get" id="list">
        <input name="q" defaultValue={one(sp.q)} placeholder="Search rig, person, hub or city" aria-label="Search rigs to audit" />
        <button type="submit">Search</button>
        {q && <Link href="/rigs/unknown">Clear</Link>}
      </form>

      {shown.length === 0 ? (
        <p className={styles.muted}>{unknown.length ? "No rigs match." : "No rigs need an audit right now."}</p>
      ) : (
        <div role="region" aria-label="Rig audit" tabIndex={0} style={{ overflowX: "auto" }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Rig</th>
                <th>Status</th>
                <th>Last with</th>
                <th>City</th>
                <th>Last activity</th>
                <th>No activity for</th>
                <th>Reports</th>
                <th>Latest report</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const r = byId.get(u.item_id);
                const list = reportsOf(u.item_id);
                const latest = list[0];
                return (
                  <tr key={u.item_id} style={u.item_id === rigId ? { background: "#eff6ff" } : undefined}>
                    <td>
                      <Link href={`${keep({ rig: u.item_id })}#report`} style={{ fontWeight: 600 }}>
                        {u.item_id}
                      </Link>
                    </td>
                    <td>{STATUS_LABELS[u.status as keyof typeof STATUS_LABELS] ?? u.status}</td>
                    <td>{displayName(people, u.holder) || hubName.get(r?.current_hub ?? "") || "—"}</td>
                    <td>{hubCity.get(r?.current_hub ?? "") ?? "—"}</td>
                    <td>{formatIst(u.lastActivity)}</td>
                    <td>{u.days} days</td>
                    <td>{list.length || "—"}</td>
                    <td>
                      {latest ? (
                        <>
                          {latest.location}
                          {latest.person_name ? ` · with ${latest.person_name}` : ""} · by {latest.recorded_by_name || latest.recorded_by}
                          {latest.photo ? " · 📷" : ""}
                        </>
                      ) : (
                        <span className={styles.muted}>None yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ROLE_LABELS } from "@/lib/labels";
import { RIG_STATE_LABELS, rigState } from "@/lib/rig-state";
import {
  fieldLeaderboard,
  longAtHardware,
  mostFailed,
  mostPassed,
  noHardwareFor,
  passRate,
  qcCountsByRig,
  qcLeaderboard,
  rankField,
  topBy,
  type RigQcCount,
} from "@/lib/rig-metrics";
import type { HardwareUpdate, Hub, Item, ItemEvent, Person, QcCheck } from "@/lib/schema";
import { n } from "./charts";
import styles from "./dashboard.module.css";

/** Thresholds used on the Rig dashboard. */
export const HARDWARE_STAY_DAYS = 2; // with the hardware team for more than this → listed
export const NO_HARDWARE_DAYS = 7; // no hardware-team event for more than this → listed
export const NO_ACTIVITY_DAYS = 7; // "Unknown" tile: rigs with no activity for more than this

const GREEN = "#15803D";
const RED = "#B42318";
const SCROLL: CSSProperties = { overflow: "auto", maxHeight: 440 };
const R: CSSProperties = { textAlign: "right" };

const rigLink = (id: string) => (
  <Link href={`/inventory/${encodeURIComponent(id)}`} className={styles.link}>
    {id}
  </Link>
);
const dateOnly = (v: string) => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—";
};
const rigWord = (c: number) => `${n(c)} rig${c === 1 ? "" : "s"}`;

function Card({ title, note, label, children }: { title: string; note?: string; label?: string; children: ReactNode }) {
  return (
    <section className={styles.card} aria-label={label ?? title}>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
        {note && <span className={styles.muted}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Leader({ label, who, value }: { label: string; who: string; value: string }) {
  return (
    <div className={styles.leader}>
      <span className={styles.leaderLabel}>{label}</span>
      <span className={styles.leaderName}>{who}</span>
      <span className={styles.leaderValue}>{value}</span>
    </div>
  );
}

function RigQcTable({ rows, mode }: { rows: RigQcCount[]; mode: "fail" | "pass" }) {
  if (!rows.length) return <p className={styles.muted}>{mode === "fail" ? "No rig has failed QC yet." : "No rig has passed QC yet."}</p>;
  return (
    <div className={styles.tableScroll} style={SCROLL} tabIndex={0} role="region" aria-label={mode === "fail" ? "Most QC failed rigs" : "Most QC passed rigs"}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Rig</th>
            <th scope="col" style={R}>{mode === "fail" ? "Fails" : "Passes"}</th>
            <th scope="col" style={R}>{mode === "fail" ? "Passes" : "Fails"}</th>
            <th scope="col">Latest result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.item_id}>
              <td>{idx + 1}</td>
              <td>{rigLink(r.item_id)}</td>
              <td style={{ ...R, fontWeight: 700, color: mode === "fail" ? RED : GREEN }}>{n(mode === "fail" ? r.fail : r.pass)}</td>
              <td style={R}>{n(mode === "fail" ? r.pass : r.fail)}</td>
              <td>
                <span style={{ color: r.lastResult === "fail" ? RED : GREEN, fontWeight: 600 }}>{r.lastResult === "fail" ? "Fail" : "Pass"}</span>
                <span className={styles.muted}> · {dateOnly(r.lastAt)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RigMetrics({
  items,
  events,
  people,
  hubs,
  qcChecks,
  hardwareUpdates,
  now,
}: {
  items: Item[];
  events: ItemEvent[];
  people: Person[];
  hubs: Hub[];
  qcChecks: QcCheck[];
  hardwareUpdates: HardwareUpdate[];
  now: Date;
}) {
  const rigs = items.filter((i) => i.item_type === "rig");
  const rigIds = new Set(rigs.map((i) => i.item_id));
  const rigChecks = qcChecks.filter((c) => rigIds.has(c.item_id));
  const rigEvents = events.filter((e) => rigIds.has(e.item_id));

  const personById = new Map(people.map((p) => [p.person_id, p]));
  const nameOf = (id: string) => personById.get(id)?.name || id || "—";
  const hubCity = new Map(hubs.map((h) => [h.hub_id, (h.city || h.name || h.hub_id).trim()]));
  const latestQc = new Map<string, string>();
  for (const c of rigChecks) latestQc.set(c.item_id, c.qc_status);

  // 1, 2
  const counts = qcCountsByRig(rigChecks);
  const failed = mostFailed(counts);
  const passed = mostPassed(counts);

  // 3
  const qcTeam = qcLeaderboard(rigChecks, 2);
  const mostDone = topBy(qcTeam, "rigs");
  const mostPass = topBy(qcTeam, "pass");
  const mostFail = topBy(qcTeam, "fail");

  // 4
  const atHardware = longAtHardware(rigs, rigEvents, hardwareUpdates, now, HARDWARE_STAY_DAYS);

  // 5 (FO and IFO only; anyone else on the list is left out)
  const field = rankField(
    fieldLeaderboard(rigs, rigEvents, rigChecks).filter((p) => {
      const role = personById.get(p.person_id)?.role;
      return role === "fo" || role === "ifo";
    }),
    nameOf,
  );

  // 6
  const noHardware = noHardwareFor(rigs, rigEvents, hardwareUpdates, people, now, NO_HARDWARE_DAYS);


  return (
    <>
      {/* 3. QC TEAM LEADERBOARD */}
      <Card title="QC team leaderboard" note="Pass and Fail recorded by each QC person">
        {qcTeam.length === 0 ? (
          <p className={styles.muted}>No QC results recorded yet.</p>
        ) : (
          <>
            <div className={styles.leaders}>
              <Leader label="Most rigs QC'd" who={mostDone?.name ?? "—"} value={mostDone ? rigWord(mostDone.rigs) : ""} />
              <Leader label="Most QC passes" who={mostPass?.name ?? "—"} value={mostPass ? `${n(mostPass.pass)} pass${mostPass.pass === 1 ? "" : "es"}` : ""} />
              <Leader label="Most QC fails" who={mostFail?.name ?? "—"} value={mostFail ? `${n(mostFail.fail)} fail${mostFail.fail === 1 ? "" : "s"}` : ""} />
            </div>
            <div className={styles.tableScroll} style={SCROLL} tabIndex={0} role="region" aria-label="QC team leaderboard table">
              <table className={styles.table} style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">QC person</th>
                    <th scope="col" style={R}>Rigs QC&apos;d</th>
                    <th scope="col" style={R}>Results</th>
                    <th scope="col" style={R}>Pass</th>
                    <th scope="col" style={R}>Fail</th>
                    <th scope="col" style={R}>Pass %</th>
                    <th scope="col" style={R}>Passed, then failed within 2 days</th>
                  </tr>
                </thead>
                <tbody>
                  {qcTeam.map((q, idx) => (
                    <tr key={q.key}>
                      <td>{idx + 1}</td>
                      <td>{q.name}</td>
                      <td style={{ ...R, fontWeight: 700 }}>{n(q.rigs)}</td>
                      <td style={R}>{n(q.checked)}</td>
                      <td style={{ ...R, color: GREEN, fontWeight: 600 }}>{n(q.pass)}</td>
                      <td style={{ ...R, color: RED, fontWeight: 600 }}>{n(q.fail)}</td>
                      <td style={R}>{q.checked ? `${Math.round((q.pass / q.checked) * 100)}%` : "—"}</td>
                      <td style={{ ...R, fontWeight: q.passFailedSoon ? 700 : 400, color: q.passFailedSoon ? RED : undefined }}>
                        {n(q.passFailedSoon)}
                        {q.pass > 0 && ` (${Math.round((q.passFailedSoon / q.pass) * 100)}% of passes)`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className={styles.muted}>
          Rigs QC&apos;d = different rigs the person recorded a Pass or Fail on. &quot;Passed, then failed within 2
          days&quot; = a rig this person passed that got a Fail within 48 hours of that pass.
        </p>
      </Card>

      {/* 1 + 2. MOST FAILED / MOST PASSED RIGS */}
      <div className={styles.chartRow}>
        <Card title="Most QC failed rigs" note={`${rigWord(failed.length)} with a Fail`}>
          <RigQcTable rows={failed} mode="fail" />
        </Card>
        <Card title="Most QC passed rigs" note={`${rigWord(passed.length)} with a Pass`}>
          <RigQcTable rows={passed} mode="pass" />
        </Card>
      </div>

      {/* 5. FO & IFO LEADERBOARD */}
      <Card title="FO & IFO leaderboard" note="Rig health after check-in: best first">
        {field.length === 0 ? (
          <p className={styles.muted}>No rigs have been checked out to an FO or IFO yet.</p>
        ) : (
          <div className={styles.tableScroll} style={SCROLL} tabIndex={0} role="region" aria-label="FO and IFO leaderboard table">
            <table className={styles.table} style={{ minWidth: 860 }}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">City</th>
                  <th scope="col" style={R}>Rigs checked out</th>
                  <th scope="col" style={R}>Checked in</th>
                  <th scope="col" style={R}>QC pass after check-in</th>
                  <th scope="col" style={R}>QC fail after check-in</th>
                  <th scope="col" style={R}>Waiting for QC</th>
                  <th scope="col" style={R}>Pass rate</th>
                </tr>
              </thead>
              <tbody>
                {field.map((p, idx) => {
                  const person = personById.get(p.person_id);
                  const rate = passRate(p);
                  return (
                    <tr key={p.person_id}>
                      <td>{idx + 1}</td>
                      <td>{nameOf(p.person_id)}</td>
                      <td>{person ? ROLE_LABELS[person.role] : "—"}</td>
                      <td>{person?.hub ? (hubCity.get(person.hub) ?? person.hub) : "—"}</td>
                      <td style={R}>{n(p.checkouts)}</td>
                      <td style={R}>{n(p.returned)}</td>
                      <td style={{ ...R, color: GREEN, fontWeight: 600 }}>{n(p.qcPass)}</td>
                      <td style={{ ...R, color: p.qcFail ? RED : undefined, fontWeight: 600 }}>{n(p.qcFail)}</td>
                      <td style={R}>{n(p.awaitingQc)}</td>
                      <td style={{ ...R, fontWeight: 700, color: rate === null ? undefined : rate >= 80 ? GREEN : rate < 50 ? RED : undefined }}>
                        {rate === null ? "—" : `${rate}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.muted}>
          When an FO or IFO checks a rig back in, the next QC result on that rig counts for them. Pass rate = QC pass ÷
          (pass + fail) after check-in. Top of the list = healthiest rigs back from the field.
        </p>
      </Card>

      {/* 4 + 6. HARDWARE */}
      <div className={styles.chartRow}>
        <Card title={`With hardware team > ${HARDWARE_STAY_DAYS} days`} note={rigWord(atHardware.length)}>
          {atHardware.length === 0 ? (
            <p className={styles.muted}>No rig has been with the hardware team for more than {HARDWARE_STAY_DAYS} days.</p>
          ) : (
            <div className={styles.tableScroll} style={SCROLL} tabIndex={0} role="region" aria-label="Rigs with the hardware team for a long time">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Rig</th>
                    <th scope="col">Hardware person</th>
                    <th scope="col">Received</th>
                    <th scope="col" style={R}>Days</th>
                    <th scope="col" style={R}>Updates</th>
                  </tr>
                </thead>
                <tbody>
                  {atHardware.map((r) => (
                    <tr key={r.item_id}>
                      <td>{rigLink(r.item_id)}</td>
                      <td>{nameOf(r.holder)}</td>
                      <td>{dateOnly(r.since)}</td>
                      <td style={{ ...R, fontWeight: 700, color: RED }}>{n(r.days)}</td>
                      <td style={R}>{n(r.updates)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.muted}>Counted from when the hardware team received the rig. Updates = hardware updates recorded since then.</p>
        </Card>

        <Card title={`No hardware check > ${NO_HARDWARE_DAYS} days`} note={rigWord(noHardware.length)}>
          {noHardware.length === 0 ? (
            <p className={styles.muted}>Every rig in use had a hardware-team event in the last {NO_HARDWARE_DAYS} days.</p>
          ) : (
            <div className={styles.tableScroll} style={SCROLL} tabIndex={0} role="region" aria-label="Rigs with no hardware check for a long time">
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Rig</th>
                    <th scope="col">Where now</th>
                    <th scope="col">Last hardware</th>
                    <th scope="col" style={R}>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {noHardware.map((r) => (
                    <tr key={r.item_id}>
                      <td>{rigLink(r.item_id)}</td>
                      <td>
                        {RIG_STATE_LABELS[rigState(r.status, latestQc.get(r.item_id))]}
                        {r.holder && <div className={styles.muted} style={{ fontSize: "0.8rem" }}>{nameOf(r.holder)}</div>}
                      </td>
                      <td>{r.lastHardware ? dateOnly(r.lastHardware) : "Never"}</td>
                      <td style={{ ...R, fontWeight: 700, color: r.days > 10 ? RED : undefined }}>{n(r.days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className={styles.muted}>
            No hardware-team event (sent to, received by or back from hardware, or a hardware update) for more than{" "}
            {NO_HARDWARE_DAYS} days. A rig that never went to hardware counts from when it was added. Consider bringing
            these back for a health check. Rigs over 10 days are in red.
          </p>
        </Card>
      </div>

    </>
  );
}
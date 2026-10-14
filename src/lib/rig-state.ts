import type { QcCheck, Status } from "./schema";

/**
 * A rig's condition in plain words, from its status and its latest QC result:
 *   QC pending                      → "QC pending"
 *   QC passed, in stock             → "QC passed · Idle"
 *   repaired by hardware, in stock  → "Repaired · Ready for field"
 *   QC failed                       → "QC failed · Send to hardware"
 */
export type RigCondition = { label: string; color: string; ready: boolean };

const GREEN = "#15803D";
const RED = "#B42318";
const AMBER = "#8A4B00";

export function rigCondition(status: Status | string, qc: string | undefined): RigCondition {
  const q = qc || "qc_pending";
  const inStock = status === "in_stock";
  if (q === "fail") return { label: "QC failed · Send to hardware", color: RED, ready: false };
  if (q === "repaired") return { label: inStock ? "Repaired · Ready for field" : "Repaired", color: GREEN, ready: true };
  if (q === "pass") return { label: inStock ? "QC passed · Idle" : "QC passed", color: GREEN, ready: true };
  return { label: "QC pending", color: AMBER, ready: false };
}

/** Latest QC result per rig (rows are stored oldest first, so the last one wins). */
export function latestQcMap(checks: QcCheck[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of checks) map.set(c.item_id, c.qc_status);
  return map;
}

export interface QcPerson {
  key: string; // login email
  name: string;
  checked: number; // Pass + Fail recorded
  pass: number;
  fail: number;
  passFailedSoon: number; // passes followed by a Fail on the same rig within `days`
}

/**
 * QC team performance: for each person who recorded results, how many rigs they passed and failed,
 * and how many of their passes were followed by a Fail on the same rig within `days` days.
 */
export function qcPerformance(checks: QcCheck[], days = 2): QcPerson[] {
  const windowMs = days * 86_400_000;
  const results = checks
    .filter((c) => c.qc_status === "pass" || c.qc_status === "fail")
    .map((c) => ({ ...c, t: Date.parse(c.recorded_at) }))
    .filter((c) => Number.isFinite(c.t));

  // Fail times per rig, to look up "failed again soon after a pass".
  const failsByRig = new Map<string, number[]>();
  for (const c of results) {
    if (c.qc_status === "fail") failsByRig.set(c.item_id, [...(failsByRig.get(c.item_id) ?? []), c.t]);
  }

  const people = new Map<string, QcPerson>();
  for (const c of results) {
    const key = (c.recorded_by || c.recorded_by_name || "unknown").toLowerCase();
    const p = people.get(key) ?? { key, name: c.recorded_by_name || c.recorded_by || "Unknown", checked: 0, pass: 0, fail: 0, passFailedSoon: 0 };
    p.checked++;
    if (c.qc_status === "fail") p.fail++;
    else {
      p.pass++;
      const soon = (failsByRig.get(c.item_id) ?? []).some((t) => t > c.t && t - c.t <= windowMs);
      if (soon) p.passFailedSoon++;
    }
    people.set(key, p);
  }
  return [...people.values()].sort((a, b) => b.checked - a.checked || a.name.localeCompare(b.name));
}
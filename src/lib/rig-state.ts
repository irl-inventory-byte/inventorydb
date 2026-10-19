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
  if (q === "fail") return { label: "QC fail · Send to hardware", color: RED, ready: false };
  if (q === "repaired") return { label: inStock ? "RTD · Ready to deploy" : "Repaired", color: GREEN, ready: true };
  if (q === "pass") return { label: inStock ? "QC passed · Idle" : "QC passed", color: GREEN, ready: true };
  return { label: "QC pending", color: AMBER, ready: false };
}

/**
 * RIG STATES on the dashboard (one per rig):
 *   in_stock    In stock            with the IM (received), or moving IM → IM
 *   hardware    With hardware team  the hardware team has received it
 *   fo          With field officer  the IM checked it out to an FO
 *   transit     In transit          the IM sent it to an IFO (courier) — only this
 *   internal    Internal            the IM checked it out to an internal person (e.g. a demo rig)
 *   qc_pending  QC pending          sent to QC or with QC (incl. QC → QC transfers), no result yet
 *   qc_pass     QC passed           QC passed it and sent it to an IM, who has not received it yet
 *                                   (once the IM receives it, it is In stock)
 *   qc_fail     QC fail             QC marked Fail; the hardware team has not received it yet
 *   rtd         RTD                 repaired by hardware and sent to / received by the IM
 *   dead        Dead / Retired      the hardware team declared it dead
 *   rnd         R&D                 the hardware team moved it to R&D (out of service)
 * Lost or damaged rigs have no tile; Rig checks still shows them as "Lost or damaged".
 */
export const RIG_STATES = [
  "in_stock",
  "hardware",
  "fo",
  "transit",
  "internal",
  "qc_pending",
  "qc_pass",
  "qc_fail",
  "rtd",
  "dead",
  "rnd",
] as const;
export type RigState = (typeof RIG_STATES)[number] | "lost" | "other";

export const RIG_STATE_LABELS: Record<RigState, string> = {
  in_stock: "In stock",
  hardware: "With hardware team",
  internal: "Internal",
  fo: "With field officer",
  transit: "In transit",
  qc_pending: "QC pending",
  qc_pass: "QC passed",
  qc_fail: "QC fail",
  rtd: "RTD (Ready to deploy)",
  dead: "Dead / Retired",
  rnd: "R&D",
  lost: "Lost or damaged",
  other: "Other",
};

export function rigState(status: Status | string, qc: string | undefined): RigState {
  switch (status) {
    case "retired":
      return "dead";
    case "rnd":
      return "rnd";
    case "lost":
    case "damaged":
      return "lost";
    case "with_hardware":
      return "hardware";
    case "pending_hardware":
      return "qc_fail";
    case "with_qc":
      return qc === "fail" ? "qc_fail" : "qc_pending";
    case "with_internal":
      return "internal";
    case "with_fo":
      return "fo";
    case "traveling":
      return "transit"; // IM → IFO only
    case "pending_qc":
      return "qc_pending"; // sent to QC (from an IM or another QC person), not received yet
    case "pending":
      // Sent to an IM, not received yet: QC → IM (passed), hardware → IM (repaired), or IM → IM.
      return qc === "pass" ? "qc_pass" : qc === "repaired" ? "rtd" : "in_stock";
    case "in_stock":
      return qc === "repaired" ? "rtd" : "in_stock";
    default:
      return "other";
  }
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
import type { HardwareUpdate, Item, ItemEvent, Person, QcCheck } from "./schema";

/**
 * RIG DASHBOARD METRICS. Everything here is worked out from data the app already records:
 * handovers (events), QC results (qc_checks) and hardware work (hardware_updates). Nothing new is saved.
 */

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const time = (s: string | undefined) => {
  const t = Date.parse(s ?? "");
  return Number.isFinite(t) ? t : NaN;
};
const isRig = (i: Item) => i.item_type === "rig";

/* ------------------------------------------------------------------ */
/* 1 + 2. Rigs with the most QC fails / most QC passes                 */
/* ------------------------------------------------------------------ */

export interface RigQcCount {
  item_id: string;
  pass: number;
  fail: number;
  lastResult: string; // "pass" | "fail" | ""
  lastAt: string; // when the latest Pass / Fail was recorded
}

/** QC Pass and Fail counts per rig. Repaired / QC pending rows are not results, so they are not counted. */
export function qcCountsByRig(checks: QcCheck[]): RigQcCount[] {
  const map = new Map<string, RigQcCount>();
  for (const c of checks) {
    if (c.qc_status !== "pass" && c.qc_status !== "fail") continue;
    const r = map.get(c.item_id) ?? { item_id: c.item_id, pass: 0, fail: 0, lastResult: "", lastAt: "" };
    if (c.qc_status === "pass") r.pass++;
    else r.fail++;
    r.lastResult = c.qc_status; // rows are oldest first, so the last one is the latest
    r.lastAt = c.recorded_at;
    map.set(c.item_id, r);
  }
  return [...map.values()];
}

/** Most fails first (ties: fewer passes first, then rig ID). Only rigs with at least one Fail. */
export const mostFailed = (counts: RigQcCount[]) =>
  counts.filter((r) => r.fail > 0).sort((a, b) => b.fail - a.fail || a.pass - b.pass || a.item_id.localeCompare(b.item_id));

/** Most passes first (ties: fewer fails first, then rig ID). Only rigs with at least one Pass. */
export const mostPassed = (counts: RigQcCount[]) =>
  counts.filter((r) => r.pass > 0).sort((a, b) => b.pass - a.pass || a.fail - b.fail || a.item_id.localeCompare(b.item_id));

/* ------------------------------------------------------------------ */
/* 3. QC team leaderboard                                              */
/* ------------------------------------------------------------------ */

export interface QcLeader {
  key: string; // login email (lower case)
  name: string;
  rigs: number; // different rigs this person recorded a result on
  checked: number; // Pass + Fail results recorded
  pass: number;
  fail: number;
  passFailedSoon: number; // their passes followed by a Fail on the same rig within `days`
}

/** Per QC person: rigs checked, results, passes, fails. Most QC done first. */
export function qcLeaderboard(checks: QcCheck[], days = 2): QcLeader[] {
  const windowMs = days * DAY_MS;
  const results = checks
    .filter((c) => c.qc_status === "pass" || c.qc_status === "fail")
    .map((c) => ({ c, t: time(c.recorded_at) }));

  const failsByRig = new Map<string, number[]>();
  for (const { c, t } of results) {
    if (c.qc_status === "fail" && Number.isFinite(t)) failsByRig.set(c.item_id, [...(failsByRig.get(c.item_id) ?? []), t]);
  }

  const people = new Map<string, QcLeader & { rigSet: Set<string> }>();
  for (const { c, t } of results) {
    const key = (c.recorded_by || c.recorded_by_name || "unknown").toLowerCase();
    const p =
      people.get(key) ??
      { key, name: c.recorded_by_name || c.recorded_by || "Unknown", rigs: 0, checked: 0, pass: 0, fail: 0, passFailedSoon: 0, rigSet: new Set<string>() };
    if (c.recorded_by_name) p.name = c.recorded_by_name; // newest name wins
    p.checked++;
    p.rigSet.add(c.item_id);
    if (c.qc_status === "fail") p.fail++;
    else {
      p.pass++;
      if (Number.isFinite(t) && (failsByRig.get(c.item_id) ?? []).some((f) => f > t && f - t <= windowMs)) p.passFailedSoon++;
    }
    people.set(key, p);
  }
  return [...people.values()]
    .map(({ rigSet, ...p }) => ({ ...p, rigs: rigSet.size }))
    .sort((a, b) => b.rigs - a.rigs || b.checked - a.checked || a.name.localeCompare(b.name));
}

/** The person with the highest value of `field` (null when nobody has any). Ties: first by name. */
export function topBy(list: QcLeader[], field: "rigs" | "pass" | "fail"): QcLeader | null {
  const best = [...list].sort((a, b) => b[field] - a[field] || a.name.localeCompare(b.name))[0];
  return best && best[field] > 0 ? best : null;
}

/* ------------------------------------------------------------------ */
/* 4. Rigs with the hardware team for more than N days                 */
/* ------------------------------------------------------------------ */

export interface HardwareStay {
  item_id: string;
  holder: string; // hardware person's ID
  since: string; // when the hardware team received it
  days: number;
  updates: number; // hardware updates recorded during this stay
}

/** Rigs that the hardware team has received and still holds, for more than `minDays` days. Longest first. */
export function longAtHardware(
  items: Item[],
  events: ItemEvent[],
  updates: HardwareUpdate[],
  now: Date,
  minDays = 2,
): HardwareStay[] {
  const receivedAt = new Map<string, string>();
  for (const e of events) if (e.status_after === "with_hardware") receivedAt.set(e.item_id, e.occurred_at); // latest wins
  const out: HardwareStay[] = [];
  for (const i of items) {
    if (!isRig(i) || i.status !== "with_hardware") continue;
    const since = receivedAt.get(i.item_id) || i.updated_at;
    const t = time(since);
    if (!Number.isFinite(t)) continue;
    const days = (now.getTime() - t) / DAY_MS;
    if (days <= minDays) continue;
    const n = updates.filter((u) => u.item_id === i.item_id && time(u.recorded_at) >= t).length;
    out.push({ item_id: i.item_id, holder: i.current_holder, since, days: Math.floor(days), updates: n });
  }
  return out.sort((a, b) => b.days - a.days || a.item_id.localeCompare(b.item_id));
}

/* ------------------------------------------------------------------ */
/* 5. FO & IFO leaderboard (rig health after check-in)                 */
/* ------------------------------------------------------------------ */

export interface FieldLeader {
  person_id: string;
  checkouts: number; // rigs checked out to them
  returned: number; // of those, checked back in by an IM
  qcPass: number; // first QC result after a check-in was Pass
  qcFail: number; // ... was Fail
  awaitingQc: number; // checked in, no QC result yet
}

const FIELD_STATUS = new Set(["with_fo", "traveling"]); // IM → FO, IM → IFO

/**
 * For every FO and IFO: how many rigs were checked out to them, how many came back, and what QC found
 * when each one came back. A check-in counts for the FO / IFO who returned it; its result is the FIRST
 * QC Pass or Fail recorded on that rig after the check-in. If the rig goes out to the field again before
 * any QC result, that check-in has no result.
 */
export function fieldLeaderboard(items: Item[], events: ItemEvent[], checks: QcCheck[]): FieldLeader[] {
  const rigIds = new Set(items.filter(isRig).map((i) => i.item_id));
  type Step = { t: number; order: number; kind: "out" | "in" | "pass" | "fail" | "reset"; person: string };
  const steps = new Map<string, Step[]>();
  const add = (id: string, s: Step) => steps.set(id, [...(steps.get(id) ?? []), s]);

  let order = 0;
  for (const e of events) {
    if (!rigIds.has(e.item_id)) continue;
    const t = time(e.occurred_at);
    if (!Number.isFinite(t)) continue;
    if (e.action === "check_out" && FIELD_STATUS.has(e.status_after)) add(e.item_id, { t, order: order++, kind: "out", person: e.to_id });
    else if (e.action === "check_out" && e.status_after === "with_internal") add(e.item_id, { t, order: order++, kind: "reset", person: "" });
    else if (e.action === "receive" && e.status_after === "in_stock") add(e.item_id, { t, order: order++, kind: "in", person: e.from_id });
  }
  for (const c of checks) {
    if (!rigIds.has(c.item_id) || (c.qc_status !== "pass" && c.qc_status !== "fail")) continue;
    const t = time(c.recorded_at);
    if (Number.isFinite(t)) add(c.item_id, { t, order: order++, kind: c.qc_status, person: "" });
  }

  const board = new Map<string, FieldLeader>();
  const get = (id: string) => {
    const p = board.get(id) ?? { person_id: id, checkouts: 0, returned: 0, qcPass: 0, qcFail: 0, awaitingQc: 0 };
    board.set(id, p);
    return p;
  };

  for (const list of steps.values()) {
    list.sort((a, b) => a.t - b.t || a.order - b.order);
    let outWith = ""; // FO / IFO holding the rig now
    let waiting = ""; // FO / IFO whose check-in is waiting for a QC result
    for (const s of list) {
      if (s.kind === "out") {
        if (waiting) get(waiting).awaitingQc--; // went out again with no QC result: that check-in has none
        waiting = "";
        outWith = s.person;
        if (s.person) get(s.person).checkouts++;
      } else if (s.kind === "reset") {
        if (waiting) get(waiting).awaitingQc--;
        waiting = "";
        outWith = "";
      } else if (s.kind === "in") {
        // Count it for the FO / IFO the rig was checked out to (an IM → IM move is not a field check-in).
        if (outWith && s.person === outWith) {
          get(outWith).returned++;
          get(outWith).awaitingQc++;
          waiting = outWith;
        }
        outWith = "";
      } else if (waiting) {
        const p = get(waiting);
        p.awaitingQc--;
        if (s.kind === "pass") p.qcPass++;
        else p.qcFail++;
        waiting = "";
      }
    }
  }
  for (const p of board.values()) p.awaitingQc = Math.max(0, p.awaitingQc);
  return [...board.values()];
}

/** Share of checked-in rigs that passed QC, 0–100, or null with no QC results yet. */
export const passRate = (p: FieldLeader) => (p.qcPass + p.qcFail ? Math.round((p.qcPass / (p.qcPass + p.qcFail)) * 100) : null);

/** Best first: highest pass rate, then most passes, then most check-outs. People with no QC result yet go last. */
export function rankField(list: FieldLeader[], name: (id: string) => string): FieldLeader[] {
  return [...list].sort((a, b) => {
    const ra = passRate(a);
    const rb = passRate(b);
    if (ra === null || rb === null) {
      if (ra !== rb) return ra === null ? 1 : -1;
    } else if (ra !== rb) return rb - ra;
    return b.qcPass - a.qcPass || b.checkouts - a.checkouts || name(a.person_id).localeCompare(name(b.person_id));
  });
}

/* ------------------------------------------------------------------ */
/* 6. Rigs with no hardware-team event for more than N days            */
/* ------------------------------------------------------------------ */

export interface NoHardware {
  item_id: string;
  status: string;
  holder: string;
  lastHardware: string; // last hardware-team event, "" = never
  since: string; // the date the count starts from (last hardware event, or when the rig was added)
  days: number;
}

const OUT_OF_USE = new Set(["with_hardware", "pending_hardware", "retired", "rnd", "lost", "damaged"]);

/**
 * Rigs in use with no hardware-team event (sent to / received by / sent back from hardware, or a hardware
 * update) for more than `minDays` days. Rigs with hardware now, dead, lost or damaged are left out.
 * A rig that never went to hardware counts from its first record in the app. Longest first.
 */
export function noHardwareFor(
  items: Item[],
  events: ItemEvent[],
  updates: HardwareUpdate[],
  people: Person[],
  now: Date,
  minDays = 7,
): NoHardware[] {
  const hardwarePeople = new Set(people.filter((p) => p.role === "hardware").map((p) => p.person_id));
  const last = new Map<string, number>();
  const first = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string, t: number, keep: "max" | "min") => {
    const cur = m.get(id);
    if (cur === undefined || (keep === "max" ? t > cur : t < cur)) m.set(id, t);
  };
  for (const e of events) {
    const t = time(e.occurred_at);
    if (!Number.isFinite(t)) continue;
    bump(first, e.item_id, t, "min");
    const hw =
      e.status_after === "pending_hardware" || e.status_after === "with_hardware" || hardwarePeople.has(e.from_id) || hardwarePeople.has(e.to_id);
    if (hw) bump(last, e.item_id, t, "max");
  }
  for (const u of updates) {
    const t = time(u.recorded_at);
    if (Number.isFinite(t)) bump(last, u.item_id, t, "max");
  }

  const out: NoHardware[] = [];
  for (const i of items) {
    if (!isRig(i) || OUT_OF_USE.has(i.status)) continue;
    const hw = last.get(i.item_id);
    const start = hw ?? first.get(i.item_id) ?? time(i.updated_at);
    if (start === undefined || !Number.isFinite(start)) continue;
    const days = (now.getTime() - start) / DAY_MS;
    if (days <= minDays) continue;
    out.push({
      item_id: i.item_id,
      status: i.status,
      holder: i.current_holder,
      lastHardware: hw === undefined ? "" : new Date(hw).toISOString(),
      since: new Date(start).toISOString(),
      days: Math.floor(days),
    });
  }
  return out.sort((a, b) => b.days - a.days || a.item_id.localeCompare(b.item_id));
}

/* ------------------------------------------------------------------ */
/* Unknown: rigs with no activity at all for more than N days          */
/* ------------------------------------------------------------------ */

export interface Inactive {
  item_id: string;
  status: string;
  holder: string;
  lastActivity: string; // ISO time of the latest handover, QC result or hardware update
  days: number;
}

// Not counted as "unknown": with or sent to hardware, dead, R&D, lost or damaged.
const NOT_UNKNOWN = new Set(["with_hardware", "pending_hardware", "retired", "rnd", "lost", "damaged"]);

/**
 * "Unknown" rigs: nothing has happened to them (no handover, QC result or hardware update) for more than
 * `minDays` days, so nobody can say where they are or how they are. Rigs with hardware, dead, R&D, lost
 * or damaged are left out. Longest first.
 */
export function inactiveRigs(
  items: Item[],
  events: ItemEvent[],
  checks: QcCheck[],
  updates: HardwareUpdate[],
  now: Date,
  minDays = 7,
): Inactive[] {
  const last = new Map<string, number>();
  const bump = (id: string, v: string) => {
    const t = time(v);
    if (Number.isFinite(t) && t > (last.get(id) ?? -Infinity)) last.set(id, t);
  };
  for (const e of events) bump(e.item_id, e.occurred_at);
  for (const c of checks) bump(c.item_id, c.recorded_at);
  for (const u of updates) bump(u.item_id, u.recorded_at);

  const out: Inactive[] = [];
  for (const i of items) {
    if (!isRig(i) || NOT_UNKNOWN.has(i.status)) continue;
    const t = last.get(i.item_id) ?? time(i.updated_at);
    if (!Number.isFinite(t)) continue;
    const days = (now.getTime() - t) / DAY_MS;
    if (days <= minDays) continue;
    out.push({ item_id: i.item_id, status: i.status, holder: i.current_holder, lastActivity: new Date(t).toISOString(), days: Math.floor(days) });
  }
  return out.sort((a, b) => b.days - a.days || a.item_id.localeCompare(b.item_id));
}

/* ------------------------------------------------------------------ */
/* 7. Hourly split of rig check-outs and check-ins (0–23, IST)         */
/* ------------------------------------------------------------------ */

export interface HourCount {
  hour: number; // 0–23, India time
  out: number; // rigs sent (check-out)
  in: number; // rigs received (check-in)
}

/** IST hour (0–23) of a stored timestamp, or -1 when it can't be read. */
export function istHour(value: string): number {
  const t = time(value);
  return Number.isFinite(t) ? new Date(t + IST_OFFSET_MS).getUTCHours() : -1;
}

/** Rigs sent and received in each hour of the day, over the last `days` days. Always 24 rows. */
export function hourlySplit(items: Item[], events: ItemEvent[], now: Date, days = 30): HourCount[] {
  const rigIds = new Set(items.filter(isRig).map((i) => i.item_id));
  const from = now.getTime() - days * DAY_MS;
  const hours: HourCount[] = Array.from({ length: 24 }, (_, hour) => ({ hour, out: 0, in: 0 }));
  for (const e of events) {
    if (!rigIds.has(e.item_id) || (e.action !== "check_out" && e.action !== "receive")) continue;
    const t = time(e.occurred_at);
    if (!Number.isFinite(t) || t < from || t > now.getTime()) continue;
    const h = istHour(e.occurred_at);
    if (h < 0) continue;
    if (e.action === "check_out") hours[h].out++;
    else hours[h].in++;
  }
  return hours;
}

/** "9 AM–10 AM" style label for an hour of the day. */
export function hourLabel(h: number): string {
  const one = (x: number) => {
    const v = x % 24;
    return `${v % 12 === 0 ? 12 : v % 12} ${v < 12 ? "AM" : "PM"}`;
  };
  return `${one(h)}–${one(h + 1)}`;
}
import { QC_LABELS } from "./labels";
import type { HardwareUpdate, Item, QcCheck } from "./schema";
import { istDate } from "./time";

/**
 * THE QC AND HARDWARE AUDIT TRAIL.
 *
 * Every QC result and every hardware update, as one list of entries that can be
 * filtered by date, person, rig and result. Nothing new is recorded here: this
 * reads the qc_checks and hardware_updates tabs and joins each row to its rig.
 *
 * Used by the report page (/rigs/audit) and its CSV download, so both show
 * exactly the same rows.
 */

export type AuditKind = "qc" | "hardware";

export interface AuditEntry {
  id: string;
  kind: AuditKind;
  /** The stored timestamp, as written (IST). */
  at: string;
  /** Parsed timestamp in ms, 0 when the stored value can't be read. */
  t: number;
  /** IST calendar date, YYYY-MM-DD, used for the date filter. */
  date: string;
  /** Login email of whoever recorded it. */
  by: string;
  byName: string;
  itemId: string;
  prism: string;
  brand: string;
  model: string;
  /** QC result (pass / fail / …) or the hardware update type. */
  result: string;
  comment: string;
}

export interface AuditFilter {
  /** YYYY-MM-DD, inclusive. Blank means no bound. */
  from: string;
  to: string;
  kind: AuditKind | "";
  /** A QC result or a hardware update type. */
  result: string;
  /** Login email of the recorder. */
  person: string;
  /** Free text matched against rig ID, prism no., brand and model. */
  q: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(value: string): string {
  return DATE_PATTERN.test(value) ? value : "";
}

/** Reads the filter out of the address bar. Anything unrecognised is ignored. */
export function readAuditFilter(get: (key: string) => string): AuditFilter {
  const kind = get("kind");
  return {
    from: cleanDate(get("from").trim()),
    to: cleanDate(get("to").trim()),
    kind: kind === "qc" || kind === "hardware" ? kind : "",
    result: get("result").trim(),
    person: get("person").trim().toLowerCase(),
    q: get("q").trim().toLowerCase(),
  };
}

/** True when no filter is set, i.e. the report is showing everything. */
export function isEmptyFilter(filter: AuditFilter): boolean {
  return !filter.from && !filter.to && !filter.kind && !filter.result && !filter.person && !filter.q;
}

/** The filter as query parameters, for the CSV link and paging. */
export function auditParams(filter: AuditFilter, extra: Record<string, string> = {}): string {
  const all: Record<string, string> = { ...filter, ...extra };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(all)) {
    if (value) params.set(key, value);
  }
  return params.toString();
}

function entryTime(value: string): { t: number; date: string } {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return { t: 0, date: "" };
  return { t, date: istDate(new Date(t)) };
}

/**
 * Every QC result and hardware update as one list, newest first.
 * Rig details come from the items list; a row whose rig was deleted still shows,
 * with blank details, so the trail stays complete.
 */
export function buildAuditEntries({
  items,
  qcChecks,
  hardwareUpdates,
}: {
  items: Item[];
  qcChecks: QcCheck[];
  hardwareUpdates: HardwareUpdate[];
}): AuditEntry[] {
  const itemById = new Map(items.map((item) => [item.item_id, item]));

  const details = (itemId: string) => {
    const item = itemById.get(itemId);
    return {
      prism: item?.prism_no ?? "",
      brand: item?.brand ?? "",
      model: item?.model ?? "",
    };
  };

  const qcEntries: AuditEntry[] = qcChecks.map((c) => ({
    id: c.check_id,
    kind: "qc" as const,
    at: c.recorded_at,
    ...entryTime(c.recorded_at),
    by: (c.recorded_by ?? "").toLowerCase(),
    byName: c.recorded_by_name || c.recorded_by || "Unknown",
    itemId: c.item_id,
    ...details(c.item_id),
    result: c.qc_status,
    comment: c.comment ?? "",
  }));

  const hardwareEntries: AuditEntry[] = hardwareUpdates.map((h) => ({
    id: h.update_id,
    kind: "hardware" as const,
    at: h.recorded_at,
    ...entryTime(h.recorded_at),
    by: (h.recorded_by ?? "").toLowerCase(),
    byName: h.recorded_by_name || h.recorded_by || "Unknown",
    itemId: h.item_id,
    ...details(h.item_id),
    result: h.update_type || "",
    comment: h.comment ?? "",
  }));

  return [...qcEntries, ...hardwareEntries].sort((a, b) => b.t - a.t || a.id.localeCompare(b.id));
}

/** The entries matching the filter, in the order they were given. */
export function filterAuditEntries(entries: AuditEntry[], filter: AuditFilter): AuditEntry[] {
  return entries.filter((e) => {
    if (filter.kind && e.kind !== filter.kind) return false;
    // An entry with an unreadable timestamp has no date, so a date filter hides it.
    if (filter.from && (!e.date || e.date < filter.from)) return false;
    if (filter.to && (!e.date || e.date > filter.to)) return false;
    if (filter.person && e.by !== filter.person) return false;
    if (filter.result && e.result !== filter.result) return false;
    if (filter.q) {
      const haystack = [e.itemId, e.prism, e.brand, e.model].join(" ").toLowerCase();
      if (!haystack.includes(filter.q)) return false;
    }
    return true;
  });
}

export interface AuditTotals {
  entries: number;
  qc: number;
  hardware: number;
  pass: number;
  fail: number;
  rigs: number;
  people: number;
}

export function auditTotals(entries: AuditEntry[]): AuditTotals {
  return {
    entries: entries.length,
    qc: entries.filter((e) => e.kind === "qc").length,
    hardware: entries.filter((e) => e.kind === "hardware").length,
    pass: entries.filter((e) => e.kind === "qc" && (e.result === "pass" || e.result === "repaired")).length,
    fail: entries.filter((e) => e.kind === "qc" && e.result === "fail").length,
    rigs: new Set(entries.map((e) => e.itemId)).size,
    people: new Set(entries.map((e) => e.by).filter(Boolean)).size,
  };
}

/** Everyone who recorded something, for the person dropdown. */
export function auditPeople(entries: AuditEntry[]): { key: string; name: string; count: number }[] {
  const people = new Map<string, { key: string; name: string; count: number }>();
  for (const e of entries) {
    if (!e.by) continue;
    const found = people.get(e.by);
    if (found) found.count++;
    else people.set(e.by, { key: e.by, name: e.byName, count: 1 });
  }
  return [...people.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Every hardware update type that appears in the data, for the result dropdown. */
export function auditUpdateTypes(entries: AuditEntry[]): string[] {
  const types = new Set(entries.filter((e) => e.kind === "hardware" && e.result).map((e) => e.result));
  return [...types].sort((a, b) => a.localeCompare(b));
}

/** A QC result reads as its label; a hardware update reads as its type. */
export function resultLabel(entry: AuditEntry): string {
  if (entry.kind === "qc") return QC_LABELS[entry.result] ?? entry.result;
  return entry.result || "Update";
}

function csvCell(value: string): string {
  const text = value ?? "";
  // Quote anything a spreadsheet would otherwise split or misread.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const AUDIT_CSV_HEADER = [
  "Recorded at (IST)",
  "Type",
  "Rig",
  "Prism no.",
  "Brand",
  "Model",
  "Result",
  "Comment",
  "Recorded by",
  "Email",
];

/** The entries as CSV, header row first. */
export function auditCsv(entries: AuditEntry[]): string {
  const rows = [
    AUDIT_CSV_HEADER,
    ...entries.map((e) => [
      e.at,
      e.kind === "qc" ? "QC result" : "Hardware update",
      e.itemId,
      e.prism,
      e.brand,
      e.model,
      resultLabel(e),
      e.comment,
      e.byName,
      e.by,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
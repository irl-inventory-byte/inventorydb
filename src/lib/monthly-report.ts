import type { Cell, SheetData } from "./xlsx";
import { QC_LABELS, ROLE_LABELS, STATUS_LABELS } from "./labels";
import type { HardwareUpdate, Hub, Item, ItemEvent, Person, QcCheck, Status } from "./schema";

/**
 * REPORT: what happened between two dates (India time), optionally for one person, one city and one item
 * type, plus where those items are now. Shown on the Dashboard and downloaded as an Excel file
 * (one sheet per part).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const TYPES = ["sd_card", "rig", "mobile"] as const;
export const REPORT_TYPE_LABEL: Record<string, string> = { sd_card: "SD cards", rig: "Rigs", mobile: "Mobiles" };
const TYPE_ONE: Record<string, string> = { sd_card: "SD card", rig: "Rig", mobile: "Mobile" };
const ACTION_LABEL: Record<string, string> = {
  check_out: "Sent",
  receive: "Received",
  check_in: "Returned",
  import: "Added",
  correct: "Correction",
  report_lost: "Reported lost",
  report_damaged: "Reported damaged",
  retire: "Retired",
  rnd: "Moved to R&D",
  reassign_home_hub: "Home hub changed",
};

const typeOf = (i: Pick<Item, "item_type"> | undefined) =>
  i?.item_type === "rig" ? "rig" : i?.item_type === "mobile" ? "mobile" : "sd_card";

/** "2026-10" for an instant, in India time. */
export const monthKey = (t: number) => new Date(t + IST_OFFSET_MS).toISOString().slice(0, 7);

/** "October 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The last `count` months, newest first, e.g. ["2026-10", "2026-09", …]. */
export function recentMonths(now: Date, count = 12): string[] {
  const d = new Date(now.getTime() + IST_OFFSET_MS);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

/** A valid "YYYY-MM", or the current month. */
export function pickMonth(raw: string | undefined, now: Date): string {
  return raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : monthKey(now.getTime());
}

/** "2026-10-24" for an instant, in India time. */
export const dayKey = (t: number) => new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);

/** The report's filters. Empty person / city / type = everyone / every city / every type. */
export interface ReportFilter {
  from: string; // "2026-10-01", inclusive
  to: string; // "2026-10-24", inclusive
  person: string; // person_id
  city: string;
  type: string; // "sd_card" | "rig" | "mobile" | ""
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Filters from the address bar (from, to, person, city, type). Default dates: 1st of this month → today. */
export function pickFilter(get: (k: string) => string | undefined, now: Date): ReportFilter {
  const today = dayKey(now.getTime());
  let from = DAY.test(get("from") ?? "") ? get("from")! : today.slice(0, 8) + "01";
  let to = DAY.test(get("to") ?? "") ? get("to")! : today;
  if (from > to) [from, to] = [to, from];
  const type = get("type") ?? "";
  return {
    from,
    to,
    person: (get("person") ?? "").trim(),
    city: (get("city") ?? "").trim(),
    type: (TYPES as readonly string[]).includes(type) ? type : "",
  };
}

const niceDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "1 Oct 2026 – 24 Oct 2026". */
export const periodLabel = (f: ReportFilter) => (f.from === f.to ? niceDay(f.from) : `${niceDay(f.from)} – ${niceDay(f.to)}`);

function attrs(raw: string): Record<string, string> {
  try {
    const p: unknown = JSON.parse(raw || "{}");
    if (p && typeof p === "object" && !Array.isArray(p)) {
      return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v ?? "")]));
    }
  } catch {
    // no details
  }
  return {};
}

export interface MonthlyInput {
  filter: ReportFilter;
  items: Item[];
  events: ItemEvent[];
  hubs: Hub[];
  people: Person[];
  qcChecks?: QcCheck[];
  hardwareUpdates?: HardwareUpdate[];
}

export interface MonthlySummaryRow {
  label: string;
  values: Record<string, number>; // per type, plus "all"
}

export interface MonthlyReport {
  filter: ReportFilter;
  label: string; // the period, e.g. "1 Oct 2026 – 24 Oct 2026"
  filterText: string; // e.g. "Zuber Khan · Bhopal · SD cards" ("" = no filter)
  types: string[]; // the item types present in the data
  summary: MonthlySummaryRow[];
  monthEvents: ItemEvent[];
  sheets: SheetData[];
}

export function buildMonthlyReport(input: MonthlyInput): MonthlyReport {
  const { filter, hubs, people } = input;
  const qcChecks = input.qcChecks ?? [];
  const hardwareUpdates = input.hardwareUpdates ?? [];
  const itemById = new Map(input.items.map((i) => [i.item_id, i]));
  const hubById = new Map(hubs.map((h) => [h.hub_id, h]));
  const hubName = (id: string) => hubById.get(id)?.name ?? id;
  const hubCity = (id: string) => (hubById.get(id)?.city || hubById.get(id)?.name || id || "").trim();
  const personById = new Map(people.map((p) => [p.person_id, p]));
  const personName = (id: string) => personById.get(id)?.name ?? id;
  const filterText = [
    filter.person ? personName(filter.person) : "",
    filter.city,
    filter.type ? REPORT_TYPE_LABEL[filter.type] : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const inPeriod = (v: string) => {
    const t = Date.parse(v);
    if (!Number.isFinite(t)) return false;
    const d = dayKey(t);
    return d >= filter.from && d <= filter.to;
  };
  const cityOk = (hubId: string) => !filter.city || hubCity(hubId).toLowerCase() === filter.city.toLowerCase();

  // Items: the chosen type, held by the chosen person, at a hub in the chosen city.
  const allById = itemById;
  const items = input.items.filter(
    (i) =>
      (!filter.type || typeOf(i) === filter.type) &&
      (!filter.person || i.current_holder === filter.person) &&
      cityOk(i.current_hub),
  );
  // Movements: of the chosen type, sent or received by the chosen person, at or from the chosen city.
  const events = input.events.filter((e) => {
    if (filter.type && typeOf(allById.get(e.item_id)) !== filter.type) return false;
    if (filter.person && e.from_id !== filter.person && e.to_id !== filter.person) return false;
    if (filter.city && !cityOk(e.hub) && !cityOk(e.from_hub ?? "")) return false;
    return true;
  });
  const when = (v: string): Cell => {
    const t = Date.parse(v);
    return Number.isFinite(t) ? { date: new Date(t) } : v || "";
  };

  const monthEvents = events.filter((e) => inPeriod(e.occurred_at)).sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const types = filter.type
    ? [filter.type]
    : TYPES.filter((t) => input.items.some((i) => typeOf(i) === t));

  // ---- Summary: one row per measure, one column per item type, plus All.
  const count = (pred: (type: string) => number) => {
    const values: Record<string, number> = {};
    let all = 0;
    for (const t of types) {
      values[t] = pred(t);
      all += values[t];
    }
    values.all = all;
    return values;
  };
  const evOf = (t: string, action: string) => monthEvents.filter((e) => e.action === action && typeOf(itemById.get(e.item_id)) === t).length;
  const statusNow = (t: string, statuses: Status[]) => items.filter((i) => typeOf(i) === t && statuses.includes(i.status as Status)).length;
  const summary: MonthlySummaryRow[] = [
    { label: "Added in period", values: count((t) => evOf(t, "import")) },
    { label: "Sent in period", values: count((t) => evOf(t, "check_out")) },
    { label: "Received in period", values: count((t) => evOf(t, "receive") + evOf(t, "check_in")) },
    { label: "Corrections in period", values: count((t) => evOf(t, "correct")) },
    { label: "Reported lost / damaged in period", values: count((t) => evOf(t, "report_lost") + evOf(t, "report_damaged")) },
    { label: "Total items now", values: count((t) => items.filter((i) => typeOf(i) === t).length) },
    { label: "In stock now", values: count((t) => statusNow(t, ["in_stock"])) },
    { label: "With field officers now", values: count((t) => statusNow(t, ["with_fo"])) },
    { label: "In transit now (IFO / sent, not received)", values: count((t) => statusNow(t, ["traveling", "pending"])) },
    { label: "With rig team / internal now", values: count((t) => statusNow(t, ["with_rig", "with_internal"])) },
    { label: "With QC / hardware now", values: count((t) => statusNow(t, ["pending_qc", "with_qc", "pending_hardware", "with_hardware"])) },
    { label: "Lost / damaged now", values: count((t) => statusNow(t, ["lost", "damaged"])) },
    { label: "Retired / R&D now", values: count((t) => statusNow(t, ["retired", "rnd"])) },
  ];

  // ---- Sheets for the Excel file.
  const summarySheet: SheetData = {
    name: "Summary",
    header: [`Report · ${periodLabel(filter)}${filterText ? ` · ${filterText}` : ""}`, ...types.map((t) => REPORT_TYPE_LABEL[t]), "All items"],
    rows: summary.map((r) => [r.label, ...types.map((t) => r.values[t]), r.values.all] as Cell[]),
  };

  const movements: SheetData = {
    name: "Movements",
    header: ["Date & time (IST)", "Type", "Item ID", "Action", "From", "From hub", "To", "To hub", "City", "Status after", "Batch", "Recorded by", "Note"],
    rows: monthEvents.map((e) => {
      const it = itemById.get(e.item_id);
      return [
        when(e.occurred_at),
        TYPE_ONE[typeOf(it)],
        e.item_id,
        ACTION_LABEL[e.action] ?? e.action,
        e.from_person || personName(e.from_id ?? ""),
        hubName(e.from_hub ?? ""),
        e.to_person || personName(e.to_id ?? ""),
        hubName(e.hub),
        hubCity(e.hub),
        STATUS_LABELS[e.status_after as Status] ?? e.status_after,
        e.batch_id,
        e.recorded_by,
        e.note,
      ];
    }),
  };

  // Who sent and received the most in the period.
  const byPerson = new Map<string, { sent: number; received: number; role: string }>();
  const bump = (id: string, key: "sent" | "received") => {
    if (!id) return;
    const row = byPerson.get(id) ?? { sent: 0, received: 0, role: personById.get(id)?.role ?? "" };
    row[key]++;
    byPerson.set(id, row);
  };
  for (const e of monthEvents) {
    if (e.action === "check_out") bump(e.from_id ?? "", "sent");
    if (e.action === "receive" || e.action === "check_in") bump(e.to_id ?? "", "received");
  }
  const peopleSheet: SheetData = {
    name: "By person",
    header: ["Person", "Role", "Hub", "City", "Items sent", "Items received"],
    rows: [...byPerson.entries()]
      .sort((a, b) => b[1].sent + b[1].received - (a[1].sent + a[1].received))
      .map(([id, r]) => {
        const p = personById.get(id);
        return [personName(id), ROLE_LABELS[r.role as keyof typeof ROLE_LABELS] ?? (r.role || "Admin"), hubName(p?.hub ?? ""), hubCity(p?.hub ?? ""), r.sent, r.received];
      }),
  };

  const hubSheet: SheetData = {
    name: "By hub now",
    header: ["Hub", "City", ...types.map((t) => REPORT_TYPE_LABEL[t]), "Total", "In stock", "Out (with people / in transit)"],
    rows: hubs
      .filter((h) => cityOk(h.hub_id))
      .map((h) => {
        const here = items.filter((i) => i.current_hub === h.hub_id);
        return [
          h.name,
          hubCity(h.hub_id),
          ...types.map((t) => here.filter((i) => typeOf(i) === t).length),
          here.length,
          here.filter((i) => i.status === "in_stock").length,
          here.filter((i) => ["with_fo", "traveling", "pending", "with_rig", "with_internal"].includes(i.status)).length,
        ] as Cell[];
      })
      .filter((r) => (r[2 + types.length] as number) > 0)
      .sort((a, b) => (b[2 + types.length] as number) - (a[2 + types.length] as number)),
  };

  // Last movement per item, for the "All items" sheet.
  const lastAt = new Map<string, string>();
  for (const e of input.events) {
    const prev = lastAt.get(e.item_id);
    if (!prev || Date.parse(e.occurred_at) > Date.parse(prev)) lastAt.set(e.item_id, e.occurred_at);
  }
  const latestQc = new Map<string, string>();
  for (const c of qcChecks) latestQc.set(c.item_id, c.qc_status);
  const allItems: SheetData = {
    name: "All items",
    header: [
      "Type", "Item ID", "Brand", "Model", "Prism no.", "Storage", "Colour", "Asset Tag", "Serial", "Category",
      "Home hub", "Current hub", "City", "Status", "With (person)", "Rig QC", "Last activity (IST)", "Penalty / cost",
    ],
    rows: [...items]
      .sort((a, b) => typeOf(a).localeCompare(typeOf(b)) || a.item_id.localeCompare(b.item_id))
      .map((i) => {
        const a = attrs(i.attributes);
        const price = Number(i.price);
        return [
          TYPE_ONE[typeOf(i)],
          i.item_id,
          i.brand,
          i.model,
          i.prism_no,
          a.capacity || a.Storage || "",
          a.card_type || "",
          a["Asset Tag"] || "",
          a.Serial || "",
          a.Category || "",
          hubName(i.home_hub),
          hubName(i.current_hub),
          hubCity(i.current_hub),
          STATUS_LABELS[i.status as Status] ?? i.status,
          i.current_holder ? personName(i.current_holder) : "",
          typeOf(i) === "rig" ? QC_LABELS[latestQc.get(i.item_id) ?? "qc_pending"] ?? latestQc.get(i.item_id) ?? "" : "",
          lastAt.has(i.item_id) ? when(lastAt.get(i.item_id)!) : "",
          i.price.trim() && Number.isFinite(price) ? { rupees: price } : "",
        ] as Cell[];
      }),
  };

  const sheets = [summarySheet, movements, peopleSheet, hubSheet, allItems];

  // Rigs: QC results and hardware updates recorded in the period (for the rigs in this report).
  if (types.includes("rig")) {
    const inReport = new Set(items.map((i) => i.item_id));
    const qcMonth = qcChecks.filter((c) => inPeriod(c.recorded_at) && inReport.has(c.item_id));
    const hwMonth = hardwareUpdates.filter((h) => inPeriod(h.recorded_at) && inReport.has(h.item_id));
    sheets.push({
      name: "Rig QC & hardware",
      header: ["Date & time (IST)", "Rig", "Kind", "Result / update", "By", "Comment"],
      rows: [
        ...qcMonth.map((c) => [when(c.recorded_at), c.item_id, "QC", QC_LABELS[c.qc_status] ?? c.qc_status, c.recorded_by_name || c.recorded_by, c.comment] as Cell[]),
        ...hwMonth.map((h) => [when(h.recorded_at), h.item_id, "Hardware", h.update_type, h.recorded_by_name || h.recorded_by, h.comment] as Cell[]),
      ].sort((a, b) => {
        const t = (c: Cell) => (c && typeof c === "object" && "date" in c ? c.date.getTime() : 0);
        return t(a[0]) - t(b[0]);
      }),
    });
  }

  return { filter, label: periodLabel(filter), filterText, types, summary, monthEvents, sheets };
}
import type { Cell, SheetData } from "./xlsx";
import { QC_LABELS, ROLE_LABELS, STATUS_LABELS } from "./labels";
import type { HardwareUpdate, Hub, Item, ItemEvent, Person, QcCheck, Status } from "./schema";

/**
 * MONTHLY REPORT: what happened in one calendar month (India time) for every item type, plus where every
 * item is now. Shown on the Dashboard and downloaded as an Excel file (one sheet per part).
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
  month: string; // "2026-10"
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
  month: string;
  label: string;
  types: string[]; // the item types present in the data
  summary: MonthlySummaryRow[];
  monthEvents: ItemEvent[];
  sheets: SheetData[];
}

export function buildMonthlyReport(input: MonthlyInput): MonthlyReport {
  const { month, items, events, hubs, people } = input;
  const qcChecks = input.qcChecks ?? [];
  const hardwareUpdates = input.hardwareUpdates ?? [];
  const itemById = new Map(items.map((i) => [i.item_id, i]));
  const hubById = new Map(hubs.map((h) => [h.hub_id, h]));
  const hubName = (id: string) => hubById.get(id)?.name ?? id;
  const hubCity = (id: string) => (hubById.get(id)?.city || hubById.get(id)?.name || id || "").trim();
  const personById = new Map(people.map((p) => [p.person_id, p]));
  const personName = (id: string) => personById.get(id)?.name ?? id;
  const inMonth = (v: string) => {
    const t = Date.parse(v);
    return Number.isFinite(t) && monthKey(t) === month;
  };
  const when = (v: string): Cell => {
    const t = Date.parse(v);
    return Number.isFinite(t) ? { date: new Date(t) } : v || "";
  };

  const monthEvents = events.filter((e) => inMonth(e.occurred_at)).sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const types = TYPES.filter((t) => items.some((i) => typeOf(i) === t));

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
    { label: "Added this month", values: count((t) => evOf(t, "import")) },
    { label: "Sent this month", values: count((t) => evOf(t, "check_out")) },
    { label: "Received this month", values: count((t) => evOf(t, "receive") + evOf(t, "check_in")) },
    { label: "Corrections this month", values: count((t) => evOf(t, "correct")) },
    { label: "Reported lost / damaged this month", values: count((t) => evOf(t, "report_lost") + evOf(t, "report_damaged")) },
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
    header: [`Monthly report · ${monthLabel(month)}`, ...types.map((t) => REPORT_TYPE_LABEL[t]), "All items"],
    rows: summary.map((r) => [r.label, ...types.map((t) => r.values[t]), r.values.all] as Cell[]),
  };

  const movements: SheetData = {
    name: "Movements this month",
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

  // Who sent and received the most this month.
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
    name: "By person this month",
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
  for (const e of events) {
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

  // Rigs: QC results and hardware updates recorded this month.
  if (types.includes("rig")) {
    const qcMonth = qcChecks.filter((c) => inMonth(c.recorded_at));
    const hwMonth = hardwareUpdates.filter((h) => inMonth(h.recorded_at));
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

  return { month, label: monthLabel(month), types, summary, monthEvents, sheets };
}
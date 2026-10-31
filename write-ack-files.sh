#!/usr/bin/env bash
set -e
cd "$(git rev-parse --show-toplevel)"
rm -f src/app/handover/ack/actions.ts

mkdir -p "src/lib"
cat > "src/lib/schema.ts" << 'CLAUDE_ACK_EOF'
// Sheet tabs and their columns. The first column of each tab is its key.
// Adding a column here and running `npm run init:sheet` extends the sheet header.

export const TABS = {
  items: [
    "item_id",
    "item_type",
    "home_hub",
    "current_hub",
    "status",
    "current_holder",
    "last_event_id",
    "updated_at",
    "attributes", // JSON of type-specific fields (serial, brand, model, ...)
    "prism_no",
    "brand",
    "model", // SD card model name
    "price",
  ],
  events: [
    "event_id",
    "batch_id",
    "item_id",
    "action",
    "from_person",
    "to_person",
    "hub",
    "status_after",
    "occurred_at",
    "recorded_at",
    "recorded_by",
    "note",
    "from_id", // person_id (or admin email) behind from_person, stays stable if a name changes
    "to_id",
    "from_hub", // the hub the card was at before this step (`hub` is where it is after)
  ],
  people: ["person_id", "name", "role", "hub", "linked_user", "active", "mobile"], // mobile: 10 digits, required for new/edited people
  hubs: ["hub_id", "name", "city", "is_central", "active", "parent_hub"], // parent_hub: the hub this one sits under, blank for a top-level hub
  item_types: ["type", "fields"],
  users: ["email", "role", "person_id", "active", "secondary_role"], // secondary_role: optional 2nd role the login can switch to
  status_limits: ["status", "max_days"],
  deletions: [
    "deletion_id",
    "deleted_at",
    "deleted_by_email",
    "deleted_by_name",
    "item_id",
    "prism_no",
    "brand",
    "model",
    "price",
    "attributes",
    "status",
    "current_hub",
    "current_holder",
    "home_hub",
    "events_deleted",
    "reason",
    "history_json",
  ],
  // Rig items only: work done by the hardware team, one row per update.
  hardware_updates: [
    "update_id",
    "item_id",
    "recorded_at",
    "recorded_by", // login email
    "recorded_by_name",
    "update_type", // e.g. Repair, Part replaced, Inspection
    "comment",
  ],
  // Rig items only: QC results, one row per check. The latest row is the rig's QC status.
  qc_checks: [
    "check_id",
    "item_id",
    "recorded_at",
    "recorded_by", // login email
    "recorded_by_name",
    "qc_status", // qc_pending | pass | fail | repaired
    "comment",
  ],
  // Unknown rigs: reports of where a rig was seen, by whom, why, with a small photo. One row per report.
  rig_reports: [
    "report_id",
    "item_id",
    "recorded_at",
    "recorded_by", // login email
    "recorded_by_name",
    "location",
    "reason",
    "photo", // small JPEG as a data: URL (shrunk on the phone to fit one sheet cell), or blank
    "hub_id", // the location chosen from the hubs list (location = its name)
    "role", // role of the person the rig is with, e.g. fo
    "person_id", // the person the rig is with (People tab)
    "person_name",
  ],
  // Audit log of admin edits to past receipts: who changed what, and when.
  receipt_edits: [
    "edit_id",
    "edited_at",
    "edited_by_email",
    "edited_by_name",
    "batch_id",
    "field",
    "old_value",
    "new_value",
  ],
  // One row per handover receipt emailed out: whether the person who received the items has
  // acknowledged them yet. Created when the receipt email is sent, updated when they click
  // Yes/No in that email (see lib/acknowledgment.ts).
  acknowledgments: [
    "ack_id",
    "batch_id",
    "action", // check_out | receive — which kind of handover this was
    "token", // secret, in the email link; the only way to answer
    "to_id", // person_id of the person who must acknowledge (who now holds the items)
    "to_person",
    "from_id", // person_id of whoever handed the items over (named in the acknowledgment wording)
    "from_person",
    "item_count",
    "created_at",
    "answer", // "" (not yet answered) | "yes" | "no"
    "answered_at",
  ],
} as const;

export type TabName = keyof typeof TABS;

export const STATUSES = [
  "in_stock",
  "pending",
  "traveling",
  "with_fo",
  "with_rig",
  "with_internal",
  "pending_qc", // rigs only: sent to a QC team member, waiting for them to receive it
  "with_qc", // rigs only: with the QC team
  "pending_hardware", // rigs only: sent to the hardware team, waiting for them to receive it
  "with_hardware", // rigs only: with the hardware team for repair
  "lost",
  "damaged",
  "retired",
  "rnd", // rigs only: moved to R&D by the hardware team (out of service, like Dead)
] as const;
export type Status = (typeof STATUSES)[number];

// Statuses where a card is out of an IM's hands and someone is expected to bring it back.
export const OUT_STATUSES: readonly Status[] = ["pending", "traveling", "with_fo", "with_rig", "with_internal"];

export const ACTIONS = [
  "check_out",
  "check_in",
  "receive",
  "report_lost",
  "report_damaged",
  "retire",
  "rnd", // the hardware team moved a rig to R&D
  "reassign_home_hub",
  "correct",
  "import",
] as const;
export type Action = (typeof ACTIONS)[number];

// "internal" = an internal person items can be handed to (no login).
export const ROLES = ["admin", "im", "ifo", "fo", "rig", "hardware", "qc", "internal"] as const;
export type Role = (typeof ROLES)[number];

export type Row = Record<string, string>;

export interface Item extends Row {
  item_id: string;
  item_type: string;
  home_hub: string;
  current_hub: string;
  status: Status;
  current_holder: string;
  last_event_id: string;
  updated_at: string;
  attributes: string;
  prism_no: string;
  brand: string;
  model: string;
  price: string;
}

export interface ItemEvent extends Row {
  event_id: string;
  batch_id: string;
  item_id: string;
  action: Action;
  from_person: string;
  to_person: string;
  hub: string;
  status_after: Status;
  occurred_at: string;
  recorded_at: string;
  recorded_by: string;
  note: string;
  from_id: string;
  to_id: string;
  from_hub: string;
}

export interface Person extends Row {
  person_id: string;
  name: string;
  role: Role;
  hub: string;
  linked_user: string;
  active: string;
}

export interface Hub extends Row {
  hub_id: string;
  name: string;
  city: string;
  is_central: string;
  active: string;
  parent_hub: string;
}

export interface AppUser extends Row {
  email: string;
  role: Role; // primary role, required
  person_id: string;
  active: string; // blank counts as active
  secondary_role: string; // optional second role (blank = none); the person can switch to it
}

export interface Deletion extends Row {
  deletion_id: string;
  deleted_at: string;
  deleted_by_email: string;
  deleted_by_name: string;
  item_id: string;
  prism_no: string;
  brand: string;
  model: string;
  price: string;
  attributes: string;
  status: string;
  current_hub: string;
  current_holder: string;
  home_hub: string;
  events_deleted: string;
  reason: string;
  history_json: string;
}

export interface ReceiptEdit extends Row {
  edit_id: string;
  edited_at: string;
  edited_by_email: string;
  edited_by_name: string;
  batch_id: string;
  field: string;
  old_value: string;
  new_value: string;
}

export interface HardwareUpdate extends Row {
  update_id: string;
  item_id: string;
  recorded_at: string;
  recorded_by: string;
  recorded_by_name: string;
  update_type: string;
  comment: string;
}

// "repaired" = the hardware team fixed it and sent it to an IM: ready for the field like a pass.
export const QC_STATUSES = ["qc_pending", "pass", "fail", "repaired"] as const;
export type QcStatus = (typeof QC_STATUSES)[number];

export interface QcCheck extends Row {
  check_id: string;
  item_id: string;
  recorded_at: string;
  recorded_by: string;
  recorded_by_name: string;
  qc_status: QcStatus;
  comment: string;
}

export interface RigReport extends Row {
  report_id: string;
  item_id: string;
  recorded_at: string;
  recorded_by: string;
  recorded_by_name: string;
  location: string;
  reason: string;
  photo: string;
  hub_id: string;
  role: string;
  person_id: string;
  person_name: string;
}

export interface Acknowledgment extends Row {
  ack_id: string;
  batch_id: string;
  action: string;
  token: string;
  to_id: string;
  to_person: string;
  from_id: string;
  from_person: string;
  item_count: string;
  created_at: string;
  answer: string; // "" | "yes" | "no"
  answered_at: string;
}

export interface TabRows {
  items: Item;
  events: ItemEvent;
  people: Person;
  hubs: Hub;
  item_types: Row;
  users: AppUser;
  status_limits: Row;
  deletions: Deletion;
  receipt_edits: ReceiptEdit;
  hardware_updates: HardwareUpdate;
  qc_checks: QcCheck;
  rig_reports: RigReport;
  acknowledgments: Acknowledgment;
}
CLAUDE_ACK_EOF

mkdir -p "src/lib/store"
cat > "src/lib/store/store.ts" << 'CLAUDE_ACK_EOF'
import {
  findInconsistencies,
  type Inconsistency,
} from "../consistency";
import type {
  Item,
  ItemEvent,
  Row,
  TabName,
  TabRows,
} from "../schema";
import type {
  DeleteItemResult,
  TableBackend,
} from "./backend";
import { matchScan, mobileAliases, scanIndex } from "../scan";

// An item's type. Older rows without a type are SD cards.
const typeOf = (item: Row) => (item.item_type === "rig" ? "rig" : item.item_type === "mobile" ? "mobile" : "sd_card");

export class Store {
  /**
   * @param types When set, only items of these types (and their events,
   *   hardware updates and QC checks) are returned. Writes are not filtered.
   */
  constructor(
    private backend: TableBackend,
    private types?: ReadonlySet<string>
  ) {}

  /**
   * The same store, limited to some item types. Used so each login only
   * sees the items it is allowed to (see lib/access.ts).
   */
  forTypes(types: readonly string[]): Store {
    const all = types.includes("sd_card") && types.includes("rig") && types.includes("mobile");
    return all && !this.types ? this : new Store(this.backend, new Set(types));
  }

  init() {
    return this.backend.ensureTabs();
  }

  /** Read a tab that may not exist yet (new tabs are created on first write). */
  private async readOptional(tab: TabName): Promise<Row[]> {
    try {
      return await this.backend.readAll(tab);
    } catch {
      return [];
    }
  }

  async list<T extends TabName>(
    tab: T
  ): Promise<TabRows[T][]> {
    // Acknowledgments are per-batch, not per-item, so they are optional (the tab may not exist yet)
    // but are never filtered by item type below.
    const optional = tab === "hardware_updates" || tab === "qc_checks" || tab === "rig_reports" || tab === "acknowledgments";
    const rows = optional
      ? await this.readOptional(tab)
      : await this.backend.readAll(tab);

    if (tab === "acknowledgments") return rows as unknown as TabRows[T][];

    const types = this.types;
    if (!types) return rows as unknown as TabRows[T][];

    if (tab === "items") {
      return rows.filter((row) => types.has(typeOf(row))) as unknown as TabRows[T][];
    }

    if (tab === "events" || optional) {
      // Keep rows that belong to a visible item.
      const visible = new Set(
        (await this.backend.readAll("items"))
          .filter((item) => types.has(typeOf(item)))
          .map((item) => item.item_id)
      );
      return rows.filter((row) => visible.has(row.item_id)) as unknown as TabRows[T][];
    }

    return rows as unknown as TabRows[T][];
  }

  /** Add rows to a tab, creating the tab first if it does not exist yet. */
  async appendRows<T extends TabName>(tab: T, rows: TabRows[T][]) {
    try {
      await this.backend.append(tab, rows as unknown as Row[]);
    } catch {
      await this.backend.ensureTabs();
      await this.backend.append(tab, rows as unknown as Row[]);
    }
  }

  upsert<T extends TabName>(
    tab: T,
    rows: Partial<TabRows[T]>[]
  ) {
    return this.backend.upsert(tab, rows as Row[]);
  }

  async getItem(itemId: string) {
    return (await this.list("items")).find(
      (item) => item.item_id === itemId
    );
  }

  /**
   * Look up scanned/typed IDs, ignoring letter case. A mobile is also found by an IMEI in a QR code
   * ("IMEI1 - IMEI2"), its Asset Tag or its Serial. Return a map keyed by the requested IDs.
   */
  async getItemsByIds(ids: string[]) {
    const items = await this.list("items");

    const exact = new Map(
      items.map((item) => [item.item_id, item])
    );
    // Mobiles can also be found by their IMEI (QR code), Asset Tag or Serial.
    const phoneAliases = new Map(
      items.filter((item) => item.item_type === "mobile").map((item) => [item.item_id, mobileAliases(item.attributes)]),
    );
    const { byUpper, phones } = scanIndex(exact.keys(), phoneAliases);

    const found = new Map<string, Item>();

    for (const id of ids) {
      const match = matchScan(id, (x) => exact.has(x), byUpper, phones);
      const item = match === undefined ? undefined : exact.get(match);

      if (item) {
        found.set(id, item);
      }
    }

    return found;
  }

  async getHistory(itemId: string) {
    const events = (await this.list("events")).filter(
      (event) => event.item_id === itemId
    );

    return events.sort(
      (a, b) =>
        Date.parse(a.occurred_at) -
        Date.parse(b.occurred_at)
    );
  }

  /**
   * Save events first, then the derived item records.
   */
  async commitBatch(
    events: ItemEvent[],
    items: Item[]
  ) {
    // Both writes at the same time (about half the waiting).
    await Promise.all([this.backend.append("events", events), this.backend.upsert("items", items)]);
  }

  async checkConsistency(): Promise<Inconsistency[]> {
    const [items, events] = await Promise.all([
      this.list("items"),
      this.list("events"),
    ]);

    return findInconsistencies(items, events);
  }

    /**
   * Record a permanent deletion in the "deletions" tab.
   * Creates the tab the first time it is needed.
   */
  async logDeletion(row: TabRows["deletions"]) {
    try {
      await this.backend.append("deletions", [row]);
    } catch {
      await this.backend.ensureTabs();
      await this.backend.append("deletions", [row]);
    }
  }
  
  /**
   * Record an admin edit to a past receipt in the "receipt_edits" tab.
   * Creates the tab the first time it is needed.
   */
  async logReceiptEdit(row: TabRows["receipt_edits"]) {
    try {
      await this.backend.append("receipt_edits", [row]);
    } catch {
      await this.backend.ensureTabs();
      await this.backend.append("receipt_edits", [row]);
    }
  }

  /**
   * Permanent deletion.
   * The calling server action must enforce Admin authorization.
   */
  async deleteItemAndHistory(
    itemId: string
  ): Promise<DeleteItemResult> {
    const id = itemId.trim();

    if (!id) {
      throw new Error("An item ID is required.");
    }

    if (!this.backend.deleteItemAndHistory) {
      throw new Error(
        "Permanent deletion is not supported by the active storage backend."
      );
    }

    return this.backend.deleteItemAndHistory(id);
  }
}
CLAUDE_ACK_EOF

mkdir -p "src/lib"
cat > "src/lib/acknowledgment.ts" << 'CLAUDE_ACK_EOF'
import { randomUUID } from "node:crypto";
import { getStore } from "./store";
import type { Acknowledgment } from "./schema";
import { istTimestamp } from "./time";

/**
 * Acknowledgment of a handover receipt: the person now holding the items confirms, with one click
 * in the receipt email, that they received everything in good condition. See lib/receipt-email.ts
 * (the email) and app/handover/ack/[token] (the page the links open).
 *
 * IMPORTANT: Acknowledgment rows are mutated after creation (Yes/No is filled in later), unlike
 * every other append-only tab in this app. Supabase's upsert fills every column of the tab with
 * blank for any key not in the row you pass it (see store/supabase.ts `clean()`), so an update here
 * always starts from the full existing row — never a partial patch — or it will wipe the rest of
 * that row back to blank.
 */

export async function createAcknowledgment(input: {
  batchId: string;
  action: string;
  toId: string;
  toPerson: string;
  fromId: string;
  fromPerson: string;
  itemCount: number;
}): Promise<Acknowledgment> {
  const row: Acknowledgment = {
    ack_id: `ack-${randomUUID().slice(0, 8)}`,
    batch_id: input.batchId,
    action: input.action,
    token: randomUUID(),
    to_id: input.toId,
    to_person: input.toPerson,
    from_id: input.fromId,
    from_person: input.fromPerson,
    item_count: String(input.itemCount),
    created_at: istTimestamp(),
    answer: "",
    answered_at: "",
  };
  await getStore().appendRows("acknowledgments", [row]);
  return row;
}

export async function findAcknowledgment(token: string): Promise<Acknowledgment | undefined> {
  if (!token) return undefined;
  const rows = await getStore().list("acknowledgments");
  return rows.find((r) => r.token === token);
}

/**
 * Record Yes/No for a token. Idempotent: if it was already answered, the first answer stands and
 * is returned unchanged (so clicking an old email link twice, or a slow double-tap, can't flip it).
 */
export async function recordAcknowledgmentAnswer(
  token: string,
  answer: "yes" | "no",
): Promise<Acknowledgment | undefined> {
  const existing = await findAcknowledgment(token);
  if (!existing) return undefined;
  if (existing.answer) return existing; // already answered — leave it alone

  const updated: Acknowledgment = { ...existing, answer, answered_at: istTimestamp() };
  await getStore().upsert("acknowledgments", [updated]); // full row — see note above
  return updated;
}
CLAUDE_ACK_EOF

mkdir -p "src/lib"
cat > "src/lib/acknowledgment-text.ts" << 'CLAUDE_ACK_EOF'
/**
 * The exact acknowledgment wording, shared by the receipt email (lib/receipt-email.ts) and the
 * confirmation page (app/handover/ack/[token]/page.tsx) so both read identically.
 */
export function acknowledgmentText(handedOverBy: string): string {
  return (
    `I acknowledge that I have received the items listed above in satisfactory condition, handed over by ${handedOverBy || "—"}. ` +
    "I understand that if I cause any damage to these items, I am liable for the penalty amounts stated in the Asset Handover and Custody Notice."
  );
}
CLAUDE_ACK_EOF

mkdir -p "src/lib"
cat > "src/lib/receipt-email.ts" << 'CLAUDE_ACK_EOF'
import nodemailer from "nodemailer";
import type { BatchSummary } from "./receipt";
import { getStore } from "./store";
import { formatIst } from "./time";
import { acknowledgmentText } from "./acknowledgment-text";

/**
 * Emails the receipt PDF to both people on a batch: the person who sent the
 * items (From) and the person who received them (To).
 *
 * Email addresses are looked up by name in the people tab of the store.
 * The lookup is forgiving:
 *   - Tab: PEOPLE_TAB if set, otherwise the first of "person", "people",
 *     "persons", "users", "employees", "staff", "team" that has data.
 *   - Email column: any column whose header contains "mail"
 *     (email, Email ID, Mail ID, Email Address, e-mail ...). If there is no
 *     such column, any cell in the row that looks like an email is used.
 *   - Name column: name, full name, person, person name, employee name ...
 *     or any column whose header contains "name".
 *   - Names are matched ignoring capital letters, extra spaces and dots,
 *     so "Sharath M S", "sharath m.s." and "SHARATH  M S" all match.
 *
 * Settings (Vercel → Project → Settings → Environment Variables):
 *   SMTP_USER     Gmail / Workspace address that sends the email   (required)
 *   SMTP_PASS     App password for that account, no spaces         (required)
 *   SMTP_HOST     default smtp.gmail.com
 *   SMTP_PORT     default 465
 *   MAIL_FROM     e.g. "Instawork Receipts <receipts@yourcompany.com>"
 *                 default: SMTP_USER
 *   PEOPLE_TAB    store tab with names and emails (optional, see above)
 */

const TAB_CANDIDATES = ["person", "people", "persons", "users", "employees", "staff", "team"];
const PREFERRED_NAME_HEADERS = [
  "name",
  "fullname",
  "person",
  "personname",
  "employeename",
  "staffname",
  "membername",
];

type Row = Record<string, unknown>;

/** "Email ID" -> "emailid", "Full Name" -> "fullname" */
const headerKey = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "Sharath  M.S." -> "sharath m s" */
const nameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function emailFromRow(row: Row): string {
  // 1. A column whose header contains "mail".
  for (const [header, value] of Object.entries(row)) {
    if (headerKey(header).includes("mail") && looksLikeEmail(text(value))) {
      return text(value);
    }
  }
  // 2. Any cell that looks like an email.
  for (const value of Object.values(row)) {
    if (looksLikeEmail(text(value))) return text(value);
  }
  return "";
}

function nameFromRow(row: Row): string {
  const entries = Object.entries(row).map(([header, value]) => [headerKey(header), text(value)] as const);

  for (const wanted of PREFERRED_NAME_HEADERS) {
    const match = entries.find(([key, value]) => key === wanted && value);
    if (match) return match[1];
  }

  // Any header containing "name", but not things like hub/location/user names.
  const loose = entries.find(
    ([key, value]) =>
      value &&
      key.includes("name") &&
      !/(hub|location|site|city|user|login|file|brand|model)/.test(key)
  );
  return loose ? loose[1] : "";
}

async function readTab(tab: string): Promise<Row[]> {
  const store = getStore();
  const list = store.list as unknown as (collection: string) => Promise<Row[]>;
  try {
    const rows = await list.call(store, tab);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export type EmailLookup = {
  /** Store tab the emails were read from ("" if none had data). */
  tab: string;
  /** Name as written on the receipt -> email address. */
  emails: Map<string, string>;
};

/**
 * Finds email addresses for the given names.
 * Exported so the on-screen receipt can show the same Email ID.
 */
export async function lookupEmails(names: string[]): Promise<EmailLookup> {
  const tabs = process.env.PEOPLE_TAB ? [process.env.PEOPLE_TAB] : TAB_CANDIDATES;

  let usedTab = "";
  let rows: Row[] = [];
  for (const tab of tabs) {
    rows = await readTab(tab);
    if (rows.length > 0) {
      usedTab = tab;
      break;
    }
  }

  const byName = new Map<string, string>();
  for (const row of rows) {
    const name = nameFromRow(row);
    const email = emailFromRow(row);
    if (name && email) byName.set(nameKey(name), email);
  }

  const emails = new Map<string, string>();
  for (const name of names) {
    const email = name ? byName.get(nameKey(name)) : undefined;
    if (email) emails.set(name, email);
  }

  return { tab: usedTab, emails };
}

/** person_id -> email: the People entry's email, else the login linked to that person on Manage users. */
async function emailsByPersonId(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const store = getStore();
    const [people, users] = await Promise.all([store.list("people"), store.list("users")]);
    for (const u of users) {
      if (u.person_id && looksLikeEmail(u.email) && u.active !== "false") out.set(u.person_id, u.email.trim());
    }
    for (const p of people) {
      if (looksLikeEmail(p.linked_user ?? "")) out.set(p.person_id, p.linked_user.trim());
    }
  } catch {
    // Fall back to the lookup by name.
  }
  return out;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function transport() {
  const user = process.env.SMTP_USER;
  const pass = (process.env.SMTP_PASS ?? "").replace(/\s+/g, "");
  if (!user || !pass) {
    throw new Error("Receipt email needs SMTP_USER and SMTP_PASS in Vercel settings.");
  }

  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export type ReceiptEmailResult = {
  sentTo: string[];
  /** Names on the batch with no email found. */
  missing: string[];
  /** Tab the emails were looked up in. */
  tab: string;
};

/**
 * Sends the receipt PDF to the given recipient(s). Pass `acknowledgment` to add a one-click
 * "Yes, I acknowledge" link for whoever is now personally holding the items — clicking it marks it
 * acknowledged immediately (see app/handover/ack/[token]), no extra confirmation step. Omit it for a
 * copy sent to someone else on the same batch (e.g. whoever handed the items over), who isn't being
 * asked to acknowledge anything.
 * Throws if sending fails; returns who it was sent to and who had no email.
 */
export async function sendReceiptEmail(options: {
  summary: BatchSummary;
  title: string;
  pdf: Uint8Array;
  fileName: string;
  receiptUrl: string;
  totalPenalty: string;
  /** Who to email (person_id + name). Default: just the To person of the receipt. */
  people?: { id: string; name: string }[];
  /** One-click acknowledgment link, shown under the receipt details. Omit to leave it out. */
  acknowledgment?: { yesUrl: string };
}): Promise<ReceiptEmailResult> {
  const { summary, title, pdf, fileName, receiptUrl, totalPenalty, acknowledgment } = options;

  const recipients = (options.people ?? [{ id: summary.toId, name: summary.toName }]).filter(
    (r) => r.id || r.name,
  );
  const names = [...new Set(recipients.map((r) => r.name).filter(Boolean))];
  const { tab, emails } = await lookupEmails(names);
  // First by person: the email on their People entry, or the login linked to them; then by name.
  const byId = await emailsByPersonId();
  const found = new Map<string, string>(); // recipient label -> email
  for (const r of recipients) {
    const email = byId.get(r.id) || (looksLikeEmail(r.id) ? r.id : "") || emails.get(r.name);
    if (email) found.set(r.name || r.id, email);
  }

  const missing = [...new Set(recipients.map((r) => r.name || r.id))].filter((label) => !found.has(label));
  const sentTo = [...new Set([...found.values()].map((e) => e.toLowerCase()))];

  if (!tab) {
    console.warn(
      `[receipt-email] No people tab found. Tried: ${(process.env.PEOPLE_TAB ? [process.env.PEOPLE_TAB] : TAB_CANDIDATES).join(", ")}. Set PEOPLE_TAB in Vercel.`
    );
  }

  if (sentTo.length === 0) {
    console.warn(
      `[receipt-email] Batch ${summary.batchId}: no email found for ${names.join(" / ")} in tab "${tab || "none"}". Nothing sent.`
    );
    return { sentTo, missing, tab };
  }

  const itemCount = summary.items.length;
  const when = `${formatIst(summary.occurredAt)} IST`;
  const sentBy = `${summary.fromName || "—"}${summary.fromHubName ? ` (${summary.fromHubName})` : ""}`;
  const sentToLabel = `${summary.toName || "—"}${summary.hubName ? ` (${summary.hubName})` : ""}`;
  const subject = `${title} ${summary.batchId} - ${summary.fromName || "—"} to ${summary.toName || "—"}`;

  const textBody = [
    `${title} for batch ${summary.batchId}`,
    "",
    `Sent by: ${sentBy}`,
    `Sent to: ${sentToLabel}`,
    `Date & time: ${when}`,
    `Items: ${itemCount}`,
    `Total listed penalty amount: ${totalPenalty}`,
    "",
    `View the receipt online: ${receiptUrl}`,
    "",
    "The PDF receipt is attached.",
    ...(acknowledgment
      ? [
          "",
          acknowledgmentText(summary.fromName),
          "",
          `Yes, I acknowledge: ${acknowledgment.yesUrl}`,
        ]
      : []),
  ].join("\n");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 16px 4px 0;color:#666">${escapeHtml(label)}</td><td style="padding:4px 0"><strong>${escapeHtml(value)}</strong></td></tr>`;

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a">
  <p style="font-size:18px;margin:0 0 12px"><strong>${escapeHtml(title)}</strong> &middot; Batch ${escapeHtml(summary.batchId)}</p>
  <table style="border-collapse:collapse">
    ${row("Sent by", sentBy)}
    ${row("Sent to", sentToLabel)}
    ${row("Date & time", when)}
    ${row("Items", String(itemCount))}
    ${row("Total listed penalty amount", totalPenalty)}
  </table>
  <p style="margin:16px 0"><a href="${escapeHtml(receiptUrl)}">View the receipt online</a></p>
  <p style="color:#666;margin:0 0 16px">The PDF receipt is attached.</p>
  ${
    acknowledgment
      ? `
  <div style="margin:20px 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
    <p style="margin:0 0 14px">${escapeHtml(acknowledgmentText(summary.fromName))}</p>
    <a href="${escapeHtml(acknowledgment.yesUrl)}" style="display:inline-block;padding:10px 18px;background:#15803D;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Yes, I acknowledge</a>
  </div>`
      : ""
  }
</div>`;

  await transport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: sentTo,
    subject,
    text: textBody,
    html,
    attachments: [
      {
        filename: fileName,
        content: Buffer.from(pdf),
        contentType: "application/pdf",
      },
    ],
  });

  console.log(`[receipt-email] Batch ${summary.batchId}: sent to ${sentTo.join(", ")}.`);
  return { sentTo, missing, tab };
}
CLAUDE_ACK_EOF

mkdir -p "src/lib"
cat > "src/lib/receipt-archive.ts" << 'CLAUDE_ACK_EOF'
import { Readable } from "node:stream";
import { google } from "googleapis";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { toBuffer as qrToBuffer } from "qrcode";
import { RECEIPT_TYPE_TITLE, byReceiptType, receiptColumns } from "./receipt-columns";
import { STATUS_LABELS } from "./labels";
import { LOGO_HEIGHT, LOGO_PATHS, LOGO_WIDTH } from "./receipt-logo";
import { formatPrice, summarizeBatch, type BatchSummary } from "./receipt";
import { sendReceiptEmail, type ReceiptEmailResult } from "./receipt-email";
import { createAcknowledgment } from "./acknowledgment";
import { getStore } from "./store";
import { formatIst } from "./time";

/**
 * Receipt archive.
 *
 * After a handover is saved, this builds a PDF of the receipt, uploads it to
 * a Google Drive folder and adds one row to the "Receipts" tab of a Google
 * Sheet with a link to the PDF.
 *
 * Settings (Vercel → Project → Settings → Environment Variables):
 *   RECEIPTS_SHEET_ID         spreadsheet that holds the "Receipts" tab
 *   RECEIPTS_DRIVE_FOLDER_ID  Drive folder the PDFs are saved in
 * The defaults below are used when these are not set.
 *
 * The service account (GOOGLE_SERVICE_ACCOUNT_EMAIL) needs Editor access to
 * the spreadsheet, and the folder must be inside a Shared Drive where the
 * service account is a Content manager. Service accounts cannot save files
 * into a normal "My Drive" folder (they have no storage of their own).
 */

const DEFAULT_SHEET_ID = "1VQrdFoSkq4vAp14G8YJkIafuPOHB834Cn0tg3E2yGL0";
const DEFAULT_FOLDER_ID = "1wTvS-vNuAHuVubDaWOsc8A8EN5V3AUDs";
const RECEIPTS_TAB = "Receipts";

const RECEIPT_HEADERS = [
  "Batch ID",
  "Receipt type",
  "Date & time (IST)",
  "From",
  "To",
  "Location",
  "Item count",
  "Serials",
  "Total penalty (Rs.)",
  "Note",
  "Recorded by",
  "Receipt link",
  "PDF",
  "Archived at (IST)",
];

const ACTION_TITLE: Record<string, string> = {
  check_out: "Handover receipt",
  receive: "Receipt confirmation",
  correct: "Correction record",
};

function googleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");

  if (!email || !key) {
    throw new Error(
      "Receipt archive needs GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY."
    );
  }

  return new google.auth.JWT({
    email,
    key,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Penalties                                                           */
/* ------------------------------------------------------------------ */

type BatchItem = BatchSummary["items"][number];

// An item that ends this batch back in stock has been returned,
// so nothing is owed for it and its penalty is zero.
function isReturned(item: BatchItem): boolean {
  return STATUS_LABELS[item.statusAfter] === "In stock";
}

function amountOf(raw: string): number {
  const n = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

type PenaltySummary = {
  /** Items that were returned in this batch (penalty is zero for these). */
  returnedCount: number;
  /** Items still with a person that have a valid penalty amount. */
  pricedCount: number;
  /** Items still with a person that have no valid penalty amount. */
  missingPriceCount: number;
  /** Total penalty owed. 0 when everything was returned, null when nothing owed has a price. */
  total: number | null;
};

function penaltySummary(summary: BatchSummary): PenaltySummary {
  const returned = summary.items.filter(isReturned);
  const owed = summary.items.filter((item) => !isReturned(item));
  const priced = owed.filter((item) => formatPrice(item.price) !== "");

  let total: number | null;
  if (owed.length === 0) {
    total = 0;
  } else if (returned.length === 0) {
    // Nothing returned: keep the total exactly as summarizeBatch worked it out.
    total = summary.totalPrice;
  } else if (priced.length === 0) {
    total = null;
  } else {
    total = priced.reduce((sum, item) => sum + amountOf(item.price), 0);
  }

  return {
    returnedCount: returned.length,
    pricedCount: priced.length,
    missingPriceCount: owed.length - priced.length,
    total,
  };
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

// The built-in PDF fonts only cover basic Western characters.
// Replace the rupee sign and drop anything else they cannot draw.
function pdfSafe(text: string): string {
  return text
    .replace(/₹/g, "Rs. ")
    .replace(/[\u202F\u2009\u200A]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\u00A0-\u00FF–—•…]/g, "?");
}

function rupees(raw: string): string {
  return pdfSafe(formatPrice(raw)).trim();
}

function rupeeTotal(total: number | null): string {
  if (total === null) return "Not set";
  if (total === 0) return "Rs. 0";
  return rupees(String(total)) || `Rs. ${total}`;
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number) {
  let value = pdfSafe(text);

  if (font.widthOfTextAtSize(value, size) <= maxWidth) {
    return value;
  }

  while (
    value.length > 1 &&
    font.widthOfTextAtSize(`${value}…`, size) > maxWidth
  ) {
    value = value.slice(0, -1);
  }

  return `${value}…`;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;

    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }

  if (line) lines.push(line);
  return lines;
}

function hex(color: string) {
  const n = parseInt(color.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function buildReceiptPdf(
  summary: BatchSummary,
  receiptUrl: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${ACTION_TITLE[summary.action] ?? "Batch record"} ${summary.batchId}`);
  doc.setAuthor("Instawork");

  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4: [number, number] = [595.28, 841.89];
  const margin = 40;
  const contentWidth = A4[0] - margin * 2;

  const black = rgb(0.1, 0.1, 0.1);
  const grey = rgb(0.4, 0.4, 0.4);
  const line = rgb(0.85, 0.85, 0.85);

  const penalties = penaltySummary(summary);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - margin;

  const text = (
    value: string,
    x: number,
    size = 10,
    font = regular,
    color = black
  ) => page.drawText(pdfSafe(value), { x, y, size, font, color });

  // Header: logo, title and QR code.
  const logoWidth = 150;
  const logoScale = logoWidth / LOGO_WIDTH;

  for (const p of LOGO_PATHS) {
    if (p.fill === "none") continue;
    page.drawSvgPath(p.d, {
      x: margin,
      y,
      scale: logoScale,
      color: hex(p.fill),
    });
  }

  const qrSize = 110;
  const qrPng = await qrToBuffer(receiptUrl, { type: "png", margin: 1, width: 330 });
  const qrImage = await doc.embedPng(qrPng);
  page.drawImage(qrImage, {
    x: A4[0] - margin - qrSize,
    y: y - qrSize,
    width: qrSize,
    height: qrSize,
  });

  y -= LOGO_HEIGHT * logoScale + 36;
  text(ACTION_TITLE[summary.action] ?? "Batch record", margin, 20, bold);

  y -= 18;
  text(
    `Batch ${summary.batchId} · ${formatIst(summary.occurredAt)} IST`,
    margin,
    10,
    regular,
    grey
  );

  y = Math.min(y, A4[1] - margin - qrSize) - 30;

  // From / To boxes, side by side.
  const ensureSpace = (needed: number, redraw?: () => void) => {
    if (y - needed < margin) {
      page = doc.addPage(A4);
      y = A4[1] - margin;
      redraw?.();
    }
  };

  const boxGap = 14;
  const boxWidth = (contentWidth - boxGap) / 2;
  const boxHeight = 62;

  const partyBox = (
    x: number,
    heading: string,
    person: string,
    location: string
  ) => {
    page.drawRectangle({
      x,
      y: y - boxHeight + 12,
      width: boxWidth,
      height: boxHeight,
      borderColor: line,
      borderWidth: 1,
    });
    const top = y;
    page.drawText(heading, { x: x + 10, y: top, size: 8.5, font: bold, color: grey });
    page.drawText("Person", { x: x + 10, y: top - 17, size: 10, font: regular, color: grey });
    page.drawText(fit(person || "—", bold, 10.5, boxWidth - 80), {
      x: x + 66, y: top - 17, size: 10.5, font: bold, color: black,
    });
    page.drawText("Location", { x: x + 10, y: top - 33, size: 10, font: regular, color: grey });
    page.drawText(fit(location || "—", regular, 10.5, boxWidth - 80), {
      x: x + 66, y: top - 33, size: 10.5, font: regular, color: black,
    });
  };

  partyBox(margin, "FROM", summary.fromName, summary.fromHubName);
  partyBox(margin + boxWidth + boxGap, "TO", summary.toName, summary.hubName);
  y -= boxHeight + 10;

  // Other batch details.
  const storageCounts = new Map<string, number>();
  for (const item of summary.items) {
    const key = item.storage || "Not set";
    storageCounts.set(key, (storageCounts.get(key) ?? 0) + 1);
  }
  const storageBreakdown = [...storageCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([size, count]) => `${size} x ${count}`)
    .join(", ");

  const itemCountLabel = `${summary.items.length} item${summary.items.length === 1 ? "" : "s"}`;

  const facts: [string, string][] = [
    ["Date & time", `${formatIst(summary.occurredAt)} IST`],
    ["Items", storageBreakdown ? `${itemCountLabel} (${storageBreakdown})` : itemCountLabel],
  ];
  if (summary.recordedBy) facts.push(["Recorded by", summary.recordedBy]);
  if (summary.note) facts.push(["Note", summary.note]);

  for (const [label, value] of facts) {
    const lines = wrap(value, regular, 10.5, contentWidth - 90);
    ensureSpace(lines.length * 14 + 6);
    text(label, margin, 10.5, regular, grey);
    lines.forEach((l, i) => {
      if (i > 0) y -= 14;
      text(l, margin + 90, 10.5);
    });
    y -= 17;
  }

  y -= 8;
  // e.g. "5 items" then, when rigs are present, "3 SD cards · 2 Rigs" beside it.
  const rigCount = summary.items.filter((i) => i.itemType === "rig").length;
  const mobileCount = summary.items.filter((i) => i.itemType === "mobile").length;
  const sdCount = summary.items.length - rigCount - mobileCount;
  text(itemCountLabel, margin, 13, bold);
  if (rigCount > 0 || mobileCount > 0) {
    const parts = [
      sdCount ? `${sdCount} SD card${sdCount === 1 ? "" : "s"}` : "",
      rigCount ? `${rigCount} Rig${rigCount === 1 ? "" : "s"}` : "",
      mobileCount ? `${mobileCount} Mobile${mobileCount === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    text(parts.join("  ·  "), margin + bold.widthOfTextAtSize(itemCountLabel, 13) + 14, 10.5, regular, grey);
  }
  y -= 22;

  // Items: one table per item type, each with its own columns (lib/receipt-columns.ts), then the Status.
  // The header repeats on each new page; the total comes once, at the end.
  const drawRow = (cells: string[], widths: number[], font: PDFFont) => {
    let x = margin;
    cells.forEach((cell, i) => {
      text(fit(cell, font, 8.5, widths[i] - 5), x + 2, 8.5, font);
      x += widths[i];
    });
    page.drawLine({
      start: { x: margin, y: y - 6 },
      end: { x: margin + contentWidth, y: y - 6 },
      thickness: 0.6,
      color: line,
    });
    y -= 19;
  };

  const groups = byReceiptType(summary.items);
  let rowNo = 0;
  for (const { type, lines: typeLines } of groups) {
    const { cols, penaltyTitle, pdfPenaltyTitle, penaltyWidth } = receiptColumns(type);
    const used = 20 + cols.reduce((t, c) => t + c.pdfWidth, 0) + penaltyWidth;
    const widths = [20, ...cols.map((c) => c.pdfWidth), penaltyWidth, Math.max(40, contentWidth - used)];
    const header = ["#", ...cols.map((c) => c.title), pdfPenaltyTitle ?? penaltyTitle, "Status"];

    if (groups.length > 1) {
      ensureSpace(60);
      text(`${RECEIPT_TYPE_TITLE[type]} (${typeLines.length})`, margin, 10.5, bold);
      y -= 16;
    }
    ensureSpace(40);
    drawRow(header, widths, bold);

    typeLines.forEach((item) => {
      ensureSpace(24, () => drawRow(header, widths, bold));

      // Rigs get a light orange row so they stand out from SD cards.
      if (item.itemType === "rig") {
        page.drawRectangle({
          x: margin,
          y: y - 6,
          width: contentWidth,
          height: 19,
          color: rgb(1, 0.984, 0.957),
        });
      }

      drawRow(
        [
          String(++rowNo),
          ...cols.map((c) => c.value(item)),
          rupees(item.price) || "Not set",
          STATUS_LABELS[item.statusAfter] ?? item.statusAfter,
        ],
        widths,
        regular
      );
    });
    y -= 6;
  }

  // Summary and total, after the last item.
  const { returnedCount, pricedCount, missingPriceCount } = penalties;

  const totalLabel =
    missingPriceCount > 0 && penalties.total !== null
      ? "Known penalty amounts subtotal"
      : "Total listed penalty amount";
  const totalValue = rupeeTotal(penalties.total);

  y -= 8;
  const sumWidth = 260;
  const sumX = margin + contentWidth - sumWidth;
  const sumHeight = 70 + (returnedCount > 0 ? 16 : 0);
  ensureSpace(sumHeight + 10);

  page.drawRectangle({
    x: sumX,
    y: y - sumHeight + 14,
    width: sumWidth,
    height: sumHeight,
    borderColor: line,
    borderWidth: 1,
  });

  const sumRow = (label: string, value: string, font: PDFFont, size: number, color = black) => {
    page.drawText(pdfSafe(label), { x: sumX + 10, y, size, font, color });
    const v = pdfSafe(value);
    page.drawText(v, {
      x: sumX + sumWidth - 10 - font.widthOfTextAtSize(v, size),
      y,
      size,
      font,
      color: black,
    });
  };

  sumRow("Total items", String(summary.items.length), regular, 10, grey);
  y -= 16;
  if (returnedCount > 0) {
    sumRow("Returned items (no penalty)", String(returnedCount), regular, 10, grey);
    y -= 16;
  }
  sumRow("Items with a penalty amount", String(pricedCount), regular, 10, grey);
  y -= 10;
  page.drawLine({
    start: { x: sumX + 10, y: y + 2 },
    end: { x: sumX + sumWidth - 10, y: y + 2 },
    thickness: 0.6,
    color: line,
  });
  y -= 14;
  sumRow(totalLabel, totalValue, bold, 11);
  y -= 34;

  if (missingPriceCount > 0) {
    const lines = wrap(
      `${missingPriceCount} item${missingPriceCount === 1 ? " has" : "s have"} no valid stored amount. Missing amounts are excluded from the total and must be verified.`,
      regular,
      9,
      contentWidth
    );
    ensureSpace(lines.length * 12 + 8);
    for (const l of lines) {
      text(l, margin, 9, regular, grey);
      y -= 12;
    }
    y -= 8;
  }

  // Responsibility notice, same wording as the on-screen receipt.
  // Left off when every item in the batch was returned, since nothing is owed.
  const allReturned = returnedCount === summary.items.length && summary.items.length > 0;

  if (!allReturned) {
    const notice =
      "IMPORTANT — ITEM RESPONSIBILITY: You are responsible for the safekeeping and timely return of the items listed on this receipt. Any loss or damage must be reported immediately. If you are found responsible following review, the applicable penalty may be deducted from your salary, subject to company policy, any required consent, and applicable law. The listed amounts are not an automatic charge.";

    const noticeLines = wrap(notice, bold, 9.5, contentWidth - 24);
    const noticeHeight = noticeLines.length * 14 + 16;
    ensureSpace(noticeHeight + 8);

    page.drawRectangle({
      x: margin,
      y: y - noticeHeight + 12,
      width: contentWidth,
      height: noticeHeight,
      color: rgb(1, 0.97, 0.97),
      borderColor: rgb(0.73, 0.11, 0.11),
      borderWidth: 1,
    });

    y -= 4;
    for (const l of noticeLines) {
      text(l, margin + 12, 9.5, bold, rgb(0.6, 0.11, 0.11));
      y -= 14;
    }
  }

  // Footer on every page: receipt link and page number.
  const pages = doc.getPages();
  pages.forEach((p: PDFPage, i: number) => {
    p.drawText(fit(`Receipt link: ${receiptUrl}`, regular, 7.5, contentWidth - 60), {
      x: margin, y: 22, size: 7.5, font: regular, color: grey,
    });
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, {
      x: margin + contentWidth - regular.widthOfTextAtSize(label, 7.5),
      y: 22, size: 7.5, font: regular, color: grey,
    });
  });

  return doc.save();
}

/* ------------------------------------------------------------------ */
/* Drive + Sheet                                                       */
/* ------------------------------------------------------------------ */

// Stop text typed by users from being read as a spreadsheet formula.
function cell(value: string | number): string | number {
  if (typeof value === "number") return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

async function ensureReceiptsTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });

  const exists = meta.data.sheets?.some(
    (s) => s.properties?.title === RECEIPTS_TAB
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: RECEIPTS_TAB } } }],
      },
    });
  }

  const head = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${RECEIPTS_TAB}'!A1:A1`,
  });

  if (!head.data.values?.[0]?.[0]) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${RECEIPTS_TAB}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [RECEIPT_HEADERS] },
    });
  }
}

/**
 * Build the receipt PDF for one batch, save it to Drive and log it in the
 * "Receipts" tab. Errors are logged and never thrown, so a Drive or Sheets
 * problem can never undo or block a handover that was already saved.
 */
export async function archiveReceipt(batchId: string, baseUrl: string) {
  try {
    await saveReceipt(batchId, baseUrl);
  } catch (error) {
    console.error(`[receipt-archive] Could not archive batch ${batchId}:`, error);
  }
}

/**
 * Same as archiveReceipt, but throws a readable error naming the step that
 * failed. Used by the admin test page at /api/receipt-test.
 */
export async function saveReceipt(batchId: string, baseUrl: string) {
  let step = "reading the batch";
  try {
    const store = getStore();
    const [events, items, hubs] = await Promise.all([
      store.list("events"),
      store.list("items"),
      store.list("hubs"),
    ]);

    const summary = summarizeBatch(events, items, hubs, batchId);
    if (!summary) {
      throw new Error(`Batch ${batchId} not found in the events tab.`);
    }

    const penalties = penaltySummary(summary);

    const receiptUrl = `${baseUrl}/handover/receipt/${encodeURIComponent(batchId)}`;
    step = "building the PDF";
    const pdf = await buildReceiptPdf(summary, receiptUrl);

    step = "signing in to Google";
    const auth = googleAuth();
    const drive = google.drive({ version: "v3", auth });
    const sheets = google.sheets({ version: "v4", auth });

    const folderId = process.env.RECEIPTS_DRIVE_FOLDER_ID || DEFAULT_FOLDER_ID;
    const spreadsheetId = process.env.RECEIPTS_SHEET_ID || DEFAULT_SHEET_ID;

    // File name: "<person receiving the items> - <date> - <batch>.pdf",
    // e.g. "Aryyaneel Saikia - 08 Oct 2026 - b-737e2401.pdf".
    // The batch ID keeps names unique when one person gets several receipts on the same day.
    const personName =
      (summary.toName || "Unknown")
        .replace(/[\\/:*?"<>|#%]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "Unknown";

    const occurred = Date.parse(summary.occurredAt);
    const datePart = Number.isNaN(occurred)
      ? summary.occurredAt.slice(0, 10)
      : new Date(occurred).toLocaleDateString("en-GB", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
        });

    const fileName = `${personName} - ${datePart} - ${batchId}.pdf`;

    step = `uploading the PDF to Drive folder ${folderId}`;
    const uploaded = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        mimeType: "application/pdf",
      },
      media: {
        mimeType: "application/pdf",
        body: Readable.from(Buffer.from(pdf)),
      },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });

    const pdfLink =
      uploaded.data.webViewLink ??
      `https://drive.google.com/file/d/${uploaded.data.id}/view`;

    step = `opening the Receipts tab in sheet ${spreadsheetId}`;
    await ensureReceiptsTab(sheets, spreadsheetId);

    const firstEvent = events.find((e) => e.batch_id === batchId);

    step = "adding the row to the Receipts tab";
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${RECEIPTS_TAB}'!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [
          [
            cell(batchId),
            cell(ACTION_TITLE[summary.action] ?? summary.action),
            cell(formatIst(summary.occurredAt)),
            cell(summary.fromName),
            cell(summary.toName),
            cell(summary.hubName),
            summary.items.length,
            cell(summary.items.map((i) => i.itemId).join(", ")),
            penalties.total ?? "",
            cell(summary.note),
            cell(firstEvent?.recorded_by ?? ""),
            `=HYPERLINK("${receiptUrl}", "Open receipt")`,
            `=HYPERLINK("${pdfLink}", "${fileName.replace(/"/g, "")}")`,
            cell(formatIst(new Date().toISOString())),
          ],
        ],
      },
    });

    // Email the PDF to the person who now holds the items (sender on a send, receiver on a receive —
    // see lib/receipt-email.ts), with a one-click "Yes, I acknowledge" to confirm they received
    // everything in good condition. Two cases get the email with no acknowledgment ask: corrections (no real "To"
    // person taking custody) and a return to stock (every item ends this batch back "In stock" — the
    // person recording it isn't taking personal custody of anything, just putting it away).
    step = "emailing the receipt to the person who now holds the items";
    const allReturned = summary.items.length > 0 && penalties.returnedCount === summary.items.length;
    const canAcknowledge =
      (summary.action === "check_out" || summary.action === "receive") &&
      (summary.toId || summary.toName) &&
      !allReturned;

    let acknowledgment: { yesUrl: string } | undefined;
    if (canAcknowledge) {
      const ack = await createAcknowledgment({
        batchId,
        action: summary.action,
        toId: summary.toId,
        toPerson: summary.toName,
        fromId: summary.fromId,
        fromPerson: summary.fromName,
        itemCount: summary.items.length,
      });
      // One click marks it acknowledged immediately — no second "Confirm" step, no "No" option.
      acknowledgment = { yesUrl: `${baseUrl}/handover/ack/${encodeURIComponent(ack.token)}` };
    }

    const email: ReceiptEmailResult = await sendReceiptEmail({
      summary,
      title: ACTION_TITLE[summary.action] ?? "Batch record",
      pdf,
      fileName,
      receiptUrl,
      totalPenalty: rupeeTotal(penalties.total),
      acknowledgment,
    });

    // On a receive, the person who handed the items over gets the same receipt too — just as a copy
    // for their own records, with no acknowledgment ask (that's only for whoever is now holding the
    // items). Skipped if there's no "from" person on this batch, or they're the same person as "to"
    // (nothing to copy them on).
    const sentTo = [...email.sentTo];
    const missing = [...email.missing];
    if (summary.action === "receive" && (summary.fromId || summary.fromName) && summary.fromId !== summary.toId) {
      const fromEmail = await sendReceiptEmail({
        summary,
        title: ACTION_TITLE[summary.action] ?? "Batch record",
        pdf,
        fileName,
        receiptUrl,
        totalPenalty: rupeeTotal(penalties.total),
        people: [{ id: summary.fromId, name: summary.fromName }],
      });
      sentTo.push(...fromEmail.sentTo);
      missing.push(...fromEmail.missing);
    }

    if (missing.length > 0) {
      console.warn(`[receipt-archive] No email found for ${missing.join(", ")} (batch ${batchId}).`);
    }

    return {
      fileName,
      pdfLink,
      emailedTo: [...new Set(sentTo)],
      noEmailFor: [...new Set(missing)],
      peopleTab: email.tab || "not found",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed while ${step}: ${message}`);
  }
}
CLAUDE_ACK_EOF

mkdir -p "src/app/handover/ack/[token]"
cat > "src/app/handover/ack/[token]/page.tsx" << 'CLAUDE_ACK_EOF'
import { findAcknowledgment, recordAcknowledgmentAnswer } from "@/lib/acknowledgment";
import { formatIst } from "@/lib/time";
import styles from "../../../admin/admin.module.css";

/**
 * Public page opened by the single "Yes, I acknowledge" link in a receipt email. No login — the
 * token in the URL is the credential, exactly like an unsubscribe link. Visiting this page IS the
 * acknowledgment: there's no second "Confirm" step and nothing else to click, so it's recorded the
 * moment the page loads, not on a separate action. (Trade-off: an email client or security scanner
 * that opens links automatically before a person does could record a false acknowledgment — accepted
 * here in exchange for a true one-click flow with no extra page in the way.)
 */
export default async function AcknowledgePage({ params }: PageProps<"/handover/ack/[token]">) {
  const { token } = await params;

  const existing = await findAcknowledgment(token);
  if (!existing) {
    return (
      <main className={styles.page}>
        <h1>Link not found</h1>
        <p className={styles.muted}>
          This acknowledgment link is invalid, or the batch it belongs to could not be found. If you
          think this is a mistake, contact the person who sent you the receipt email.
        </p>
      </main>
    );
  }

  // Idempotent: if this link was already opened, this just shows the same result again.
  const ack = existing.answer ? existing : (await recordAcknowledgmentAnswer(token, "yes")) ?? existing;

  return (
    <main className={styles.page}>
      <h1>Acknowledged</h1>
      <p>
        Thanks — batch {ack.batch_id} ({ack.item_count} item{ack.item_count === "1" ? "" : "s"}) is
        recorded as acknowledged, at {formatIst(ack.answered_at)} IST.
      </p>
      <p className={styles.muted}>No further action is needed.</p>
    </main>
  );
}
CLAUDE_ACK_EOF

mkdir -p "src/app/dashboard/my"
cat > "src/app/dashboard/my/page.tsx" << 'CLAUDE_ACK_EOF'
import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { QC_LABELS, ROLE_LABELS, STATUS_LABELS, one } from "@/lib/labels";
import { OUT_STATUSES, type Acknowledgment, type HardwareUpdate, type Item, type QcCheck, type Status } from "@/lib/schema";
import { MY_DASHBOARD_ROLES, RECEIVE_ROLES, storeFor } from "@/lib/access";
import { formatIst } from "@/lib/time";
import styles from "../dashboard.module.css";

// Statuses in which an item is in someone's hands (QC and hardware hold rigs too).
const HELD_STATUSES: readonly Status[] = [...OUT_STATUSES, "with_qc", "with_hardware"];

const QC_COLOR: Record<string, string> = { pass: "#15803D", repaired: "#15803D", fail: "#B42318", qc_pending: "#8A4B00" };

// Activity records displayed per page.
const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  check_out: "Sent",
  check_in: "Checked in",
  receive: "Received",
  report_lost: "Reported lost",
  report_damaged: "Reported damaged",
  retire: "Retired",
  reassign_home_hub: "Changed home hub",
  correct: "Corrected",
  import: "Imported",
};

/**
 * One line of a card's breakdown: the rig (IC number) and the details needed to
 * recognise it without opening the item page.
 */
interface DetailRow {
  key: string;
  itemId: string;
  prism: string;
  brand: string;
  model: string;
  status: string;
  qc: string;
  where: string;
  when: string;
  note: string;
}

/**
 * A summary card. `view` makes the card clickable: the rigs behind the number are
 * listed under the cards when ?view= matches.
 */
interface Metric {
  label: string;
  value: string;
  view?: string;
  rows?: DetailRow[];
  /** Heading for the breakdown, when the card label doesn't read well as one. */
  rowsTitle?: string;
  /** What `when` holds for this card, e.g. "Recorded at". */
  whenLabel?: string;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function numberText(value: number): string {
  return value.toLocaleString("en-IN");
}

// Avoid displaying invalid dates.
function displayTime(value: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return "—";
  }

  return formatIst(value);
}

function eventTime(recordedAt: string, occurredAt: string): number {
  const recorded = Date.parse(recordedAt);

  if (Number.isFinite(recorded)) {
    return recorded;
  }

  const occurred = Date.parse(occurredAt);
  return Number.isFinite(occurred) ? occurred : 0;
}

export default async function MyDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string | string[];
    view?: string | string[];
  }>;
}) {
  // Authenticate and authorize on the server.
  const user = await requireRole(...MY_DASHBOARD_ROLES);
  const isQc = user.role === "qc";
  const isHardware = user.role === "hardware";
  const canReceive = RECEIVE_ROLES.includes(user.role);
  const email = normalizeEmail(user.email ?? "");

  // Never match an empty login email to blank event records.
  if (!email) {
    return (
      <div className={styles.root}>
        <main className={styles.wrap}>
          <p className={styles.back}>
            <Link href="/">← Home</Link>
          </p>

          <h1>My dashboard</h1>

          <p className={styles.warn}>
            Your login has no email address. Please sign out and
            sign in again.
          </p>
        </main>
      </div>
    );
  }

  const sp = await searchParams;
  const store = storeFor(user.role);

  const [events, items, people, hubs, users, qcChecks, hardwareUpdates, acknowledgments] = await Promise.all([
    store.list("events"),
    store.list("items"),
    store.list("people"),
    store.list("hubs"),
    store.list("users"),
    isQc || isHardware ? store.list("qc_checks") : Promise.resolve([] as QcCheck[]),
    isHardware ? store.list("hardware_updates") : Promise.resolve([] as HardwareUpdate[]),
    !isQc && !isHardware ? store.list("acknowledgments") : Promise.resolve([] as Acknowledgment[]),
  ]);

  // Latest QC result per rig (rows are oldest first, so the last one wins).
  const latestQc = new Map<string, string>();
  const latestQcAt = new Map<string, number>();
  for (const c of qcChecks) {
    latestQc.set(c.item_id, c.qc_status);
    const t = Date.parse(c.recorded_at);
    if (Number.isFinite(t)) latestQcAt.set(c.item_id, t);
  }

  // QC results and hardware updates this login recorded, newest first.
  const byMe = (v: string) => normalizeEmail(v ?? "") === email;
  const myQc = qcChecks.filter((c) => byMe(c.recorded_by)).reverse();
  const myHardware = hardwareUpdates.filter((h) => byMe(h.recorded_by)).reverse();

  const hubNames = new Map(
    hubs.map((hub) => [hub.hub_id, hub.name])
  );

  const personNames = new Map(
    people.map((person) => [person.person_id, person.name])
  );

  const itemById = new Map(items.map((item) => [item.item_id, item]));

  /*
   * PERSONAL ACTIVITY
   *
   * Filter before rendering or paginating.
   * recorded_by is expected to contain the recorder's login email.
   * from_id and to_id are not used to identify the recorder.
   */
  const myEvents = events
    .filter(
      (event) =>
        normalizeEmail(event.recorded_by ?? "") === email
    )
    .sort(
      (a, b) =>
        eventTime(b.recorded_at, b.occurred_at) -
        eventTime(a.recorded_at, a.occurred_at)
    );

  /*
   * PERSONAL HOLDINGS
   *
   * Resolve the person associated with the authenticated login.
   * Check both users.person_id and people.linked_user.
   * Conflicting links must be corrected rather than guessed.
   */
  const candidatePersonIds = new Set<string>();

  for (const account of users) {
    if (normalizeEmail(account.email ?? "") === email) {
      const id = (account.person_id ?? "").trim();

      if (id) {
        candidatePersonIds.add(id);
      }
    }
  }

  for (const person of people) {
    if (normalizeEmail(person.linked_user ?? "") === email) {
      const id = (person.person_id ?? "").trim();

      if (id) {
        candidatePersonIds.add(id);
      }
    }
  }

  // The live link (works for an Admin acting as QC / hardware too); otherwise the single match found here.
  const linkedPersonId =
    user.personId ||
    (candidatePersonIds.size === 1
      ? Array.from(candidatePersonIds)[0]
      : undefined);

  const matchingPersonRecords = linkedPersonId
    ? people.filter(
        (person) => person.person_id === linkedPersonId
      )
    : [];

  const linkedPerson =
    matchingPersonRecords.length === 1
      ? matchingPersonRecords[0]
      : undefined;


  // Holdings are current-state records, not historical activity.
  const myItems = linkedPerson
    ? items.filter(
        (item) =>
          item.current_holder === linkedPerson.person_id &&
          HELD_STATUSES.includes(item.status)
      )
    : [];

  /*
   * Each count is an item-event count.
   * Sending several cards in one batch may create several events.
   */
  const sentCount = myEvents.filter(
    (event) => event.action === "check_out"
  ).length;

  const receivedCount = myEvents.filter(
    (event) => event.action === "receive"
  ).length;

  /*
   * Acknowledgments of batches I sent (action = check_out, from_id = me): how many items the
   * receiver has confirmed they got in good condition, out of how many I sent in total.
   */
  const mySentAcks = linkedPersonId
    ? acknowledgments.filter((a) => a.action === "check_out" && a.from_id === linkedPersonId)
    : [];
  const sentItemsTotal = mySentAcks.reduce((sum, a) => sum + (Number(a.item_count) || 0), 0);
  const sentItemsAcked = mySentAcks
    .filter((a) => a.answer === "yes")
    .reduce((sum, a) => sum + (Number(a.item_count) || 0), 0);
  const sentItemsFlagged = mySentAcks
    .filter((a) => a.answer === "no")
    .reduce((sum, a) => sum + (Number(a.item_count) || 0), 0);

  /*
   * Cards still with me: their latest event is a receive I recorded
   * (I haven't sent them on since), plus any cards assigned to my
   * person record in an out status.
   */
  const eventById = new Map(
    events.map((event) => [event.event_id, event])
  );

  const withMeIds = new Set(myItems.map((item) => item.item_id));

  const withMeItems = [
    ...myItems,
    ...items.filter((item) => {
      if (withMeIds.has(item.item_id)) return false;
      const last = eventById.get(item.last_event_id);
      return (
        last?.action === "receive" &&
        normalizeEmail(last.recorded_by ?? "") === email
      );
    }),
  ];

  const correctionCount = myEvents.filter(
    (event) =>
      event.action === "correct" ||
      event.action === "reassign_home_hub"
  ).length;

  // Pagination includes only this user's recorded events.
  const requestedPage = Number(one(sp.page));

  const totalPages = Math.max(
    1,
    Math.ceil(myEvents.length / PAGE_SIZE)
  );

  const page = Math.min(
    totalPages,
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1
  );

  const shownEvents = myEvents.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  // Where this login sent rigs: to an IM (QC pass / repaired) or to the hardware team (QC fail).
  const sentToImEvents = myEvents.filter((e) => e.action === "check_out" && e.status_after === "pending");
  const sentToHardwareEvents = myEvents.filter((e) => e.action === "check_out" && e.status_after === "with_hardware");
  const sentToIm = sentToImEvents.length;
  const sentToHardware = sentToHardwareEvents.length;

  // A rig with me is waiting for QC when no result was recorded since it reached me.
  const waitingForQc = (item: (typeof items)[number]) => {
    const arrived = Date.parse(eventById.get(item.last_event_id)?.occurred_at ?? item.updated_at ?? "");
    const checked = latestQcAt.get(item.item_id);
    return checked === undefined || (Number.isFinite(arrived) && checked < arrived);
  };

  // Rigs sent to my team that nobody has received yet (Receive items shows the same list). Anyone in the
  // team can receive them, so the whole team's count is shown, with how many were sent to me by name.
  const teamWaiting = items.filter((i) => i.status === (isQc ? "pending_qc" : "pending_hardware"));
  const teamWaitingMine = linkedPerson ? teamWaiting.filter((i) => i.current_holder === linkedPerson.person_id) : [];
  const toReceive = teamWaiting.length;
  const toReceiveMine = teamWaitingMine.length;

  /*
   * BREAKDOWN ROWS
   *
   * Each card's number is turned into the rigs behind it, so clicking the card
   * shows the IC numbers and their details without a trip to another page.
   */

  // Where a rig is right now: the person holding it, else its hub.
  const whereOf = (item: Item | undefined) =>
    (item && (personNames.get(item.current_holder) ?? hubNames.get(item.current_hub) ?? item.current_hub)) || "—";

  const rowFromItem = (item: Item, extra?: { when?: string; note?: string }): DetailRow => ({
    key: item.item_id,
    itemId: item.item_id,
    prism: item.prism_no || "",
    brand: item.brand || "",
    model: item.model || "",
    status: STATUS_LABELS[item.status] ?? item.status,
    qc: latestQc.get(item.item_id) || "qc_pending",
    where: whereOf(item),
    when: extra?.when ?? (eventById.get(item.last_event_id)?.occurred_at || item.updated_at || ""),
    note: extra?.note ?? "",
  });

  // A row for a QC result or hardware update: the rig's details, plus when and what was written.
  const rowFromRecord = (
    id: string,
    itemId: string,
    when: string,
    note: string,
    qcOverride?: string,
  ): DetailRow => {
    const item = itemById.get(itemId);
    return {
      key: id,
      itemId,
      prism: item?.prism_no || "",
      brand: item?.brand || "",
      model: item?.model || "",
      status: item ? STATUS_LABELS[item.status] ?? item.status : "—",
      qc: qcOverride ?? latestQc.get(itemId) ?? "qc_pending",
      where: whereOf(item),
      when,
      note,
    };
  };

  const itemRows = (list: Item[]) => list.map((item) => rowFromItem(item));

  // Rigs this login sent on: the event says when and to whom.
  const sentRows = (list: typeof myEvents) =>
    list.map((event) => {
      const item = itemById.get(event.item_id);
      return {
        ...rowFromRecord(event.event_id, event.item_id, event.occurred_at || event.recorded_at, event.note || ""),
        where: event.to_person || whereOf(item),
      };
    });

  const qcRows = (list: QcCheck[]) =>
    list.map((c) => rowFromRecord(c.check_id, c.item_id, c.recorded_at, c.comment || "", c.qc_status));

  const hardwareRows = (list: HardwareUpdate[]) =>
    list.map((h) =>
      rowFromRecord(h.update_id, h.item_id, h.recorded_at, [h.update_type, h.comment].filter(Boolean).join(": ")),
    );

  const qcMetrics: Metric[] = [
    {
      label: "Waiting for the QC team to receive",
      value: numberText(toReceive),
      view: "to_receive",
      rows: itemRows(teamWaiting),
      rowsTitle: "Rigs sent to the QC team, not received yet",
      whenLabel: "Sent at",
    },
    {
      label: "Of these, sent to me",
      value: numberText(toReceiveMine),
      view: "to_receive_mine",
      rows: itemRows(teamWaitingMine),
      rowsTitle: "Rigs sent to me, not received yet",
      whenLabel: "Sent at",
    },
    {
      label: "Rigs with me",
      value: numberText(withMeItems.length),
      view: "with_me",
      rows: itemRows(withMeItems),
      rowsTitle: "Rigs currently with me",
      whenLabel: "Since",
    },
    {
      label: "Waiting for my QC result",
      value: numberText(withMeItems.filter(waitingForQc).length),
      view: "awaiting_qc",
      rows: itemRows(withMeItems.filter(waitingForQc)),
      rowsTitle: "Rigs with me that still need a QC result",
      whenLabel: "Since",
    },
    {
      label: "QC pass recorded",
      value: numberText(myQc.filter((c) => c.qc_status === "pass").length),
      view: "qc_pass",
      rows: qcRows(myQc.filter((c) => c.qc_status === "pass")),
      rowsTitle: "Rigs I passed",
      whenLabel: "Recorded at",
    },
    {
      label: "QC fail recorded",
      value: numberText(myQc.filter((c) => c.qc_status === "fail").length),
      view: "qc_fail",
      rows: qcRows(myQc.filter((c) => c.qc_status === "fail")),
      rowsTitle: "Rigs I failed",
      whenLabel: "Recorded at",
    },
    {
      label: "Sent to IM",
      value: numberText(sentToIm),
      view: "sent_im",
      rows: sentRows(sentToImEvents),
      rowsTitle: "Rigs I sent to an IM",
      whenLabel: "Sent at",
    },
    {
      label: "Sent to hardware team",
      value: numberText(sentToHardware),
      view: "sent_hardware",
      rows: sentRows(sentToHardwareEvents),
      rowsTitle: "Rigs I sent to the hardware team",
      whenLabel: "Sent at",
    },
  ];

  const hardwareMetrics: Metric[] = [
    {
      label: "Waiting for the hardware team to receive",
      value: numberText(toReceive),
      view: "to_receive",
      rows: itemRows(teamWaiting),
      rowsTitle: "Rigs sent to the hardware team, not received yet",
      whenLabel: "Sent at",
    },
    {
      label: "Of these, sent to me",
      value: numberText(toReceiveMine),
      view: "to_receive_mine",
      rows: itemRows(teamWaitingMine),
      rowsTitle: "Rigs sent to me, not received yet",
      whenLabel: "Sent at",
    },
    {
      label: "Rigs with me",
      value: numberText(withMeItems.length),
      view: "with_me",
      rows: itemRows(withMeItems),
      rowsTitle: "Rigs currently with me",
      whenLabel: "Since",
    },
    {
      label: "Hardware updates logged",
      value: numberText(myHardware.length),
      view: "hw_updates",
      rows: hardwareRows(myHardware),
      rowsTitle: "Hardware updates I logged",
      whenLabel: "Recorded at",
    },
    {
      label: "Repaired and sent to IM",
      value: numberText(sentToIm),
      view: "sent_im",
      rows: sentRows(sentToImEvents),
      rowsTitle: "Rigs I repaired and sent to an IM",
      whenLabel: "Sent at",
    },
  ];

  const handlerMetrics: Metric[] = [
    {
      label: "My recorded events",
      value: numberText(myEvents.length),
    },
    {
      label: "Sent events",
      value: numberText(sentCount),
    },
    {
      label: "Received events",
      value: numberText(receivedCount),
    },
    {
      label: "Acknowledged",
      value: sentItemsTotal ? `${numberText(sentItemsAcked)} of ${numberText(sentItemsTotal)}` : "—",
    },
    ...(sentItemsFlagged > 0
      ? [
          {
            label: "Flagged as a problem",
            value: numberText(sentItemsFlagged),
          },
        ]
      : []),
    {
      label: "Correction events",
      value: numberText(correctionCount),
    },
    {
      label: "Items currently with me",
      value: numberText(withMeItems.length),
      view: "with_me",
      rows: itemRows(withMeItems),
      rowsTitle: "Items currently with me",
      whenLabel: "Since",
    },
  ];

  const metrics = isQc ? qcMetrics : isHardware ? hardwareMetrics : handlerMetrics;
  const withMeTitle = isQc || isHardware ? "Rigs currently with me" : "Items currently with me";

  // The card the breakdown is open on, from ?view=.
  const requestedView = one(sp.view);
  const openMetric = metrics.find((m) => m.view && m.view === requestedView);
  const openRows = openMetric?.rows ?? [];
  const showQcColumn = isQc || isHardware;

  // Keeps the breakdown open while paging through the activity list below.
  const pageHref = (n: number) =>
    openMetric?.view ? `/dashboard/my?view=${openMetric.view}&page=${n}` : `/dashboard/my?page=${n}`;

  return (
    <div className={styles.root}>
      <main className={styles.wrap}>
        <p className={styles.back}>
          <Link href="/">← Home</Link>
        </p>

        <div className={styles.top}>
          <div>
            <h1>My dashboard</h1>

            <p className={styles.subtitle}>
              {linkedPerson?.name
                ? `${linkedPerson.name} · `
                : ""}
              {user.email} · {ROLE_LABELS[user.role]}
            </p>
          </div>

          <div className={styles.actions}>
            <Link
              href="/dashboard/my"
              className={styles.btn}
            >
              Refresh
            </Link>

            <Link
              href="/dashboard"
              className={styles.btn}
            >
              Inventory Dashboard
            </Link>

            <Link
              href="/handover/send"
              className={styles.btn}
            >
              Send items
            </Link>

            {canReceive && (
              <Link
                href="/handover/receive"
                className={styles.btn}
              >
                Receive items
              </Link>
            )}

            {(isQc || isHardware) && (
              <Link href="/rigs" className={styles.btn}>
                Rig checks
              </Link>
            )}

            {(isQc || isHardware) && (
              <Link href="/rigs/audit" className={styles.btn}>
                Audit trail
              </Link>
            )}
          </div>
        </div>

        {!isQc && !isHardware && (
          <p className={styles.muted}>
            All available history recorded by your login. Counts
            represent item-event records, not unique cards or
            handover batches. Current holdings are shown separately.
          </p>
        )}

        {/* Personal summary cards. A card with a breakdown opens it below when clicked. */}
        <section
          aria-label="My activity summary"
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
            gap: 16,
            marginBottom: 24,
          }}
        >
          {metrics.map((metric) => {
            const open = Boolean(metric.view) && metric.view === openMetric?.view;

            const body = (
              <>
                <span className={styles.summaryLabel}>
                  {metric.label}
                </span>

                <span className={styles.summaryValue}>
                  {metric.value}
                </span>

                {metric.view && (
                  <span className={styles.summaryNote}>
                    {open ? "Hide details" : "Show details"}
                  </span>
                )}
              </>
            );

            // Cards without a breakdown stay plain text, so nothing looks clickable for no reason.
            if (!metric.view) {
              return (
                <div key={metric.label} className={styles.summary}>
                  {body}
                </div>
              );
            }

            return (
              <Link
                key={metric.label}
                href={open ? "/dashboard/my" : `/dashboard/my?view=${metric.view}`}
                className={styles.summary}
                aria-current={open ? "true" : undefined}
                scroll={false}
                style={
                  open
                    ? { borderColor: "var(--text-primary)", boxShadow: "0 4px 14px rgba(11, 11, 11, 0.1)" }
                    : undefined
                }
              >
                {body}
              </Link>
            );
          })}
        </section>

        {/* The rigs behind the card that was clicked: IC number first, then the details. */}
        {openMetric && (
          <section className={styles.card} aria-label={openMetric.rowsTitle ?? openMetric.label} style={{ marginBottom: 24 }}>
            <div className={styles.top}>
              <h2>{openMetric.rowsTitle ?? openMetric.label}</h2>

              <div className={styles.actions}>
                <Link href="/dashboard/my" className={styles.btn}>
                  Close
                </Link>
              </div>
            </div>

            {openRows.length === 0 ? (
              <p className={styles.muted}>Nothing to show here right now.</p>
            ) : (
              <div
                className={styles.tableScroll}
                role="region"
                aria-label={openMetric.rowsTitle ?? openMetric.label}
                tabIndex={0}
                style={{ maxHeight: "500px", overflow: "auto" }}
              >
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">IC number</th>
                      <th scope="col">Prism no.</th>
                      <th scope="col">Brand</th>
                      <th scope="col">Model</th>
                      <th scope="col">Status</th>
                      {showQcColumn && <th scope="col">QC</th>}
                      <th scope="col">Where</th>
                      <th scope="col">{openMetric.whenLabel ?? "When"} (IST)</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>

                  <tbody>
                    {openRows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <Link href={`/inventory/${encodeURIComponent(row.itemId)}`}>{row.itemId}</Link>
                        </td>

                        <td>{row.prism || "—"}</td>
                        <td>{row.brand || "—"}</td>
                        <td>{row.model || "—"}</td>
                        <td>{row.status}</td>

                        {showQcColumn && (
                          <td style={{ fontWeight: 600, color: QC_COLOR[row.qc] }}>
                            {QC_LABELS[row.qc] ?? row.qc}
                          </td>
                        )}

                        <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{row.where || "—"}</td>
                        <td>{displayTime(row.when)}</td>
                        <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{row.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>

                  <tfoot>
                    <tr>
                      <th scope="row">Total</th>
                      <td colSpan={showQcColumn ? 8 : 7}>
                        <strong>{numberText(openRows.length)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Items assigned to the person linked to this login. */}
        <section
          className={styles.card}
          aria-label={withMeTitle}
        >
          <h2>{withMeTitle}</h2>

          {/* The items still with me; the box above shows the same count. */}
          {(
            <div
              className={styles.tableScroll}
              role="region"
              aria-label="My assigned items"
              tabIndex={0}
              style={{
                maxHeight: "400px",
                overflow: "auto",
              }}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Serial</th>
                    <th scope="col">Brand</th>
                    <th scope="col">Model</th>
                    <th scope="col">Status</th>
                    {(isQc || isHardware) && <th scope="col">QC</th>}
                    <th scope="col">Current hub</th>
                  </tr>
                </thead>

                <tbody>
                  {withMeItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={isQc || isHardware ? 6 : 5}
                        className={styles.muted}
                      >
                        No items are currently with you.
                      </td>
                    </tr>
                  ) : (
                    withMeItems.map((item) => (
                      <tr key={item.item_id}>
                        <td>
                          <Link
                            href={`/inventory/${item.item_id}`}
                          >
                            {item.item_id}
                          </Link>
                        </td>

                        <td>{item.brand || "—"}</td>
                        <td>{item.model || "—"}</td>

                        <td>
                          {STATUS_LABELS[item.status] ??
                            item.status}
                        </td>

                        {(isQc || isHardware) && (
                          <td
                            style={{
                              fontWeight: 600,
                              color: QC_COLOR[latestQc.get(item.item_id) || "qc_pending"],
                            }}
                          >
                            {QC_LABELS[latestQc.get(item.item_id) || "qc_pending"]}
                          </td>
                        )}

                        <td>
                          {hubNames.get(item.current_hub) ??
                            (item.current_hub || "—")}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>

                {/* Total appears after the full list. */}
                <tfoot>
                  <tr>
                    <th scope="row">Grand total</th>
                    <td colSpan={isQc || isHardware ? 5 : 4}>
                      <strong>
                        {numberText(withMeItems.length)}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* QC team: every QC result this login recorded. */}
        {isQc && (
          <section className={styles.card} aria-label="My QC results" style={{ marginTop: 24 }}>
            <h2>My QC results</h2>
            {myQc.length === 0 ? (
              <p className={styles.muted}>No QC results recorded yet. Open a rig from Rig checks to record Pass or Fail.</p>
            ) : (
              <div className={styles.tableScroll} role="region" aria-label="My QC results" tabIndex={0} style={{ maxHeight: "400px", overflow: "auto" }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Recorded at (IST)</th>
                      <th scope="col">Rig</th>
                      <th scope="col">Result</th>
                      <th scope="col">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myQc.map((c) => (
                      <tr key={c.check_id}>
                        <td>{displayTime(c.recorded_at)}</td>
                        <td>
                          <Link href={`/inventory/${encodeURIComponent(c.item_id)}`}>{c.item_id}</Link>
                        </td>
                        <td style={{ fontWeight: 600, color: QC_COLOR[c.qc_status] }}>{QC_LABELS[c.qc_status] ?? c.qc_status}</td>
                        <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{c.comment || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Hardware team: every repair update this login recorded. */}
        {isHardware && (
          <section className={styles.card} aria-label="My hardware updates" style={{ marginTop: 24 }}>
            <h2>My hardware updates</h2>
            {myHardware.length === 0 ? (
              <p className={styles.muted}>No hardware updates recorded yet. Open a rig from Rig checks to add one.</p>
            ) : (
              <div className={styles.tableScroll} role="region" aria-label="My hardware updates" tabIndex={0} style={{ maxHeight: "400px", overflow: "auto" }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Recorded at (IST)</th>
                      <th scope="col">Rig</th>
                      <th scope="col">Update</th>
                      <th scope="col">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myHardware.map((h) => (
                      <tr key={h.update_id}>
                        <td>{displayTime(h.recorded_at)}</td>
                        <td>
                          <Link href={`/inventory/${encodeURIComponent(h.item_id)}`}>{h.item_id}</Link>
                        </td>
                        <td>{h.update_type || "—"}</td>
                        <td style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{h.comment || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* History recorded by the authenticated login email. */}
        <section
          className={styles.card}
          aria-label="My recorded activity"
          style={{ marginTop: 24 }}
        >
          <h2>My recorded activity</h2>

          {myEvents.length === 0 ? (
            <p className={styles.muted}>
              No events have recorded_by matching your login email.
              A handover involving you may have been recorded by
              another user. Older records without your email in
              recorded_by will not appear here.
            </p>
          ) : (
            <>
              <p className={styles.muted}>
                Showing{" "}
                {numberText((page - 1) * PAGE_SIZE + 1)}–
                {numberText(
                  (page - 1) * PAGE_SIZE + shownEvents.length
                )}{" "}
                of {numberText(myEvents.length)} events.
                Times are IST.
              </p>

              <div
                className={styles.tableScroll}
                role="region"
                aria-label="My activity history"
                tabIndex={0}
                style={{
                  maxHeight: "500px",
                  overflow: "auto",
                }}
              >
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Recorded at (IST)</th>
                      <th scope="col">Occurred at (IST)</th>
                      <th scope="col">Action</th>
                      <th scope="col">Serial</th>
                      <th scope="col">From</th>
                      <th scope="col">To</th>
                      <th scope="col">Hub</th>
                      <th scope="col">Status after</th>
                      <th scope="col">Batch ID</th>
                      <th scope="col">Note</th>
                    </tr>
                  </thead>

                  <tbody>
                    {shownEvents.map((event) => (
                      <tr key={event.event_id}>
                        <td>
                          {displayTime(event.recorded_at)}
                        </td>

                        <td>
                          {displayTime(event.occurred_at)}
                        </td>

                        <td>
                          {ACTION_LABELS[event.action] ??
                            event.action}
                        </td>

                        <td>
                          <Link
                            href={`/inventory/${event.item_id}`}
                          >
                            {event.item_id}
                          </Link>
                        </td>

                        <td
                          style={{
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {event.from_person || "—"}
                        </td>

                        <td
                          style={{
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {event.to_person || "—"}
                        </td>

                        <td>
                          {hubNames.get(event.hub) ??
                            (event.hub || "—")}
                        </td>

                        <td>
                          {STATUS_LABELS[event.status_after] ??
                            event.status_after}
                        </td>

                        <td>{event.batch_id || "—"}</td>

                        <td
                          style={{
                            whiteSpace: "normal",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {event.note || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                className={styles.actions}
                style={{
                  marginTop: 16,
                  flexWrap: "wrap",
                }}
              >
                {page > 1 && (
                  <Link
                    href={pageHref(page - 1)}
                    className={styles.btn}
                  >
                    ← Previous
                  </Link>
                )}

                <span className={styles.muted}>
                  Page {page} of {totalPages}
                </span>

                {page < totalPages && (
                  <Link
                    href={pageHref(page + 1)}
                    className={styles.btn}
                  >
                    Next →
                  </Link>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
CLAUDE_ACK_EOF

mkdir -p "supabase"
cat > "supabase/setup.sql" << 'CLAUDE_ACK_EOF'
-- Inventory app: tables for Supabase.
-- Run this ONCE in Supabase → SQL Editor → New query → paste → Run.
-- One table per Google Sheet tab, same column names. Every value is text, like the sheet.
-- _seq keeps rows in the order they were added (the app relies on oldest-first order).
-- Row Level Security is ON with no policies: only the app's server (secret / service_role key) can read or write.

create table if not exists public.items (
  _seq bigint generated always as identity,
  item_id text primary key,
  item_type text not null default '',
  home_hub text not null default '',
  current_hub text not null default '',
  status text not null default '',
  current_holder text not null default '',
  last_event_id text not null default '',
  updated_at text not null default '',
  attributes text not null default '',
  prism_no text not null default '',
  brand text not null default '',
  model text not null default '',
  price text not null default ''
);
create index if not exists items_seq_idx on public.items (_seq);
alter table public.items enable row level security;

create table if not exists public.events (
  _seq bigint generated always as identity,
  event_id text primary key,
  batch_id text not null default '',
  item_id text not null default '',
  action text not null default '',
  from_person text not null default '',
  to_person text not null default '',
  hub text not null default '',
  status_after text not null default '',
  occurred_at text not null default '',
  recorded_at text not null default '',
  recorded_by text not null default '',
  note text not null default '',
  from_id text not null default '',
  to_id text not null default '',
  from_hub text not null default ''
);
create index if not exists events_seq_idx on public.events (_seq);
alter table public.events enable row level security;

create table if not exists public.people (
  _seq bigint generated always as identity,
  person_id text primary key,
  name text not null default '',
  role text not null default '',
  hub text not null default '',
  linked_user text not null default '',
  active text not null default '',
  mobile text not null default ''
);
create index if not exists people_seq_idx on public.people (_seq);
alter table public.people enable row level security;

create table if not exists public.hubs (
  _seq bigint generated always as identity,
  hub_id text primary key,
  name text not null default '',
  city text not null default '',
  is_central text not null default '',
  active text not null default '',
  parent_hub text not null default ''
);
create index if not exists hubs_seq_idx on public.hubs (_seq);
alter table public.hubs enable row level security;

create table if not exists public.item_types (
  _seq bigint generated always as identity,
  type text primary key,
  fields text not null default ''
);
create index if not exists item_types_seq_idx on public.item_types (_seq);
alter table public.item_types enable row level security;

create table if not exists public.users (
  _seq bigint generated always as identity,
  email text primary key,
  role text not null default '',
  person_id text not null default '',
  active text not null default '',
  secondary_role text not null default ''
);
-- For a database created before secondary_role existed:
alter table public.users add column if not exists secondary_role text not null default '';
create index if not exists users_seq_idx on public.users (_seq);
alter table public.users enable row level security;

create table if not exists public.status_limits (
  _seq bigint generated always as identity,
  status text primary key,
  max_days text not null default ''
);
create index if not exists status_limits_seq_idx on public.status_limits (_seq);
alter table public.status_limits enable row level security;

create table if not exists public.deletions (
  _seq bigint generated always as identity,
  deletion_id text primary key,
  deleted_at text not null default '',
  deleted_by_email text not null default '',
  deleted_by_name text not null default '',
  item_id text not null default '',
  prism_no text not null default '',
  brand text not null default '',
  model text not null default '',
  price text not null default '',
  attributes text not null default '',
  status text not null default '',
  current_hub text not null default '',
  current_holder text not null default '',
  home_hub text not null default '',
  events_deleted text not null default '',
  reason text not null default '',
  history_json text not null default ''
);
create index if not exists deletions_seq_idx on public.deletions (_seq);
alter table public.deletions enable row level security;

create table if not exists public.hardware_updates (
  _seq bigint generated always as identity,
  update_id text primary key,
  item_id text not null default '',
  recorded_at text not null default '',
  recorded_by text not null default '',
  recorded_by_name text not null default '',
  update_type text not null default '',
  comment text not null default ''
);
create index if not exists hardware_updates_seq_idx on public.hardware_updates (_seq);
alter table public.hardware_updates enable row level security;

create table if not exists public.qc_checks (
  _seq bigint generated always as identity,
  check_id text primary key,
  item_id text not null default '',
  recorded_at text not null default '',
  recorded_by text not null default '',
  recorded_by_name text not null default '',
  qc_status text not null default '',
  comment text not null default ''
);
create index if not exists qc_checks_seq_idx on public.qc_checks (_seq);
alter table public.qc_checks enable row level security;

create table if not exists public.rig_reports (
  _seq bigint generated always as identity,
  report_id text primary key,
  item_id text not null default '',
  recorded_at text not null default '',
  recorded_by text not null default '',
  recorded_by_name text not null default '',
  location text not null default '',
  reason text not null default '',
  photo text not null default '',
  hub_id text not null default '',
  role text not null default '',
  person_id text not null default '',
  person_name text not null default ''
);
create index if not exists rig_reports_seq_idx on public.rig_reports (_seq);
create index if not exists rig_reports_item_id_idx on public.rig_reports (item_id);
alter table public.rig_reports enable row level security;

create table if not exists public.receipt_edits (
  _seq bigint generated always as identity,
  edit_id text primary key,
  edited_at text not null default '',
  edited_by_email text not null default '',
  edited_by_name text not null default '',
  batch_id text not null default '',
  field text not null default '',
  old_value text not null default '',
  new_value text not null default ''
);
create index if not exists receipt_edits_seq_idx on public.receipt_edits (_seq);
alter table public.receipt_edits enable row level security;

-- One row per handover receipt emailed out: whether the person who received the items has
-- acknowledged them (Yes/No, clicked in that email). answer is '' until they answer.
create table if not exists public.acknowledgments (
  _seq bigint generated always as identity,
  ack_id text primary key,
  batch_id text not null default '',
  action text not null default '',
  token text not null default '',
  to_id text not null default '',
  to_person text not null default '',
  from_id text not null default '',
  from_person text not null default '',
  item_count text not null default '',
  created_at text not null default '',
  answer text not null default '',
  answered_at text not null default ''
);
create index if not exists acknowledgments_seq_idx on public.acknowledgments (_seq);
create unique index if not exists acknowledgments_token_idx on public.acknowledgments (token);
create index if not exists acknowledgments_batch_id_idx on public.acknowledgments (batch_id);
alter table public.acknowledgments enable row level security;

-- Change counters: every write to a table adds 1 to its number here (done by the triggers below, so
-- edits made in the Supabase Table Editor count too). The app reads these few numbers first and only
-- downloads a table again when its number changed, so pages and the Back button do not re-download
-- 50,000 events every time.
create table if not exists public.table_versions (
  tab text primary key,
  v bigint not null default 0
);
alter table public.table_versions enable row level security;

create or replace function public.bump_table_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.table_versions (tab, v) values (tg_table_name, 1)
  on conflict (tab) do update set v = public.table_versions.v + 1;
  return null;
end $$;
revoke all on function public.bump_table_version() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['items','events','people','hubs','item_types','users','status_limits',
    'deletions','hardware_updates','qc_checks','rig_reports','receipt_edits','acknowledgments'] loop
    execute format('drop trigger if exists bump_version on public.%I', t);
    execute format(
      'create trigger bump_version after insert or update or delete or truncate on public.%I '
      'for each statement execute function public.bump_table_version()', t);
  end loop;
end $$;

-- The app's server key (service_role) must be able to read and write every table, even on projects
-- that do not grant table access automatically. Browser keys (anon) get nothing.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Faster item history and deletes.
create index if not exists events_item_id_idx on public.events (item_id);
create index if not exists qc_checks_item_id_idx on public.qc_checks (item_id);
create index if not exists hardware_updates_item_id_idx on public.hardware_updates (item_id);
CLAUDE_ACK_EOF

echo "All acknowledgment-feature files written."

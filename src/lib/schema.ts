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
}
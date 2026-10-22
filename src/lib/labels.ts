import type { Role, Status } from "./schema";

export const STATUS_LABELS: Record<Status, string> = {
  in_stock: "In stock",
  pending: "Pending receipt",
  traveling: "Traveling (IFO)",
  with_fo: "With FO",
  with_rig: "With rig team",
  with_internal: "With internal",
  pending_qc: "Sent to QC (not received)",
  with_qc: "With QC team",
  pending_hardware: "Sent to hardware (not received)",
  with_hardware: "With hardware team",
  lost: "Lost",
  damaged: "Damaged",
  retired: "Retired",
  rnd: "R&D",
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  im: "IM",
  ifo: "IFO",
  fo: "FO",
  rig: "Rig team",
  hardware: "Hardware team",
  qc: "QC team",
  internal: "Internal",
};

export const ITEM_TYPE_LABELS: Record<string, string> = {
  sd_card: "SD card",
  rig: "Rig",
  mobile: "Mobile",
};

export const QC_LABELS: Record<string, string> = {
  qc_pending: "QC pending",
  pass: "QC passed",
  fail: "QC failed",
  repaired: "Repaired",
};

/** First value of a search param, which Next may give as string, array or undefined. */
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
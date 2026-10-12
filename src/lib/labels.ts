import type { Role, Status } from "./schema";

export const STATUS_LABELS: Record<Status, string> = {
  in_stock: "In stock",
  pending: "Pending receipt",
  traveling: "Traveling (IFO)",
  with_fo: "With FO",
  with_rig: "With rig team",
  with_internal: "With internal",
  lost: "Lost",
  damaged: "Damaged",
  retired: "Retired",
};

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  im: "IM",
  ifo: "IFO",
  fo: "FO",
  rig: "Rig team",
  hardware: "Hardware team",
  qc: "QC team",
};

export const ITEM_TYPE_LABELS: Record<string, string> = {
  sd_card: "SD card",
  rig: "Rig",
};

export const QC_LABELS: Record<string, string> = {
  qc_pending: "QC pending",
  pass: "Pass",
  fail: "Fail",
};

/** First value of a search param, which Next may give as string, array or undefined. */
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
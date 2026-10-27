import type { ScanOutcome } from "../CameraScanButton";
import { addItems, checkSerials } from "./actions";
import { addMobiles } from "./mobile-actions";
import { addRigs } from "./rig-actions";

/**
 * Camera scanning on the Add pages: each scanned code is saved to the inventory straight away, with the
 * same server checks as the Add forms (lookup sheet, already in the inventory, required details).
 * Each returns what the camera screen shows for that code.
 */

const sentence = (text: string) => {
  const t = text.trim().replace(/\.$/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Not saved";
};

export async function cameraAddSdCard(code: string, homeHub: string): Promise<ScanOutcome> {
  const type = "SD card";
  if (!homeHub) return { type, ok: false, message: "Select the home hub first" };

  const found = await checkSerials([code]);
  if ("error" in found) return { type, ok: false, message: found.error };
  const row = found[0];
  if (!row || row.status === "notfound") return { type, ok: false, message: "Not in the SD card sheet" };
  if (row.status === "exists") return { id: row.serial, type, ok: false, message: "Already in the inventory" };
  if (!row.capacity) {
    return { id: row.serial, type, ok: false, message: "No storage size in the SD card sheet. Add it with the form" };
  }

  const out = await addItems({
    homeHub,
    rows: [
      {
        serial: row.serial,
        prismNo: row.prismNo,
        brand: row.brand,
        model: row.model,
        capacity: row.capacity,
        cardType: row.cardType,
      },
    ],
  });
  if (out.added.length) return { id: out.added[0], type, ok: true, message: `Saved · ${row.capacity}` };
  return { id: row.serial, type, ok: false, message: sentence(out.skipped[0]?.reason ?? out.error ?? "") };
}

export async function cameraAddRig(code: string): Promise<ScanOutcome> {
  const type = "Rig";
  const out = await addRigs([code]);
  if (out.added.length) return { id: out.added[0], type, ok: true, message: "Saved · QC pending" };
  return { type, ok: false, message: sentence(out.skipped[0]?.reason ?? out.error ?? "") };
}

export async function cameraAddMobile(code: string): Promise<ScanOutcome> {
  const type = "Mobile";
  const out = await addMobiles([code]);
  if (out.added.length) return { id: out.added[0], type, ok: true, message: "Saved" };
  return { type, ok: false, message: sentence(out.skipped[0]?.reason ?? out.error ?? "") };
}

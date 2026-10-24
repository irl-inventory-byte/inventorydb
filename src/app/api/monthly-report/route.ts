import { VIEW_ROLES, storeForAll } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { buildMonthlyReport, pickFilter } from "@/lib/monthly-report";
import type { HardwareUpdate, QcCheck } from "@/lib/schema";
import { buildXlsx } from "@/lib/xlsx";

/**
 * Download the report as an Excel file:
 *   GET /api/monthly-report?from=2026-10-01&to=2026-10-24&person=P-12&city=Bhopal&type=sd_card
 * Person, city and type are optional. Every item type the login can see. Sheets: Summary, Movements,
 * By person, By hub now, All items, and (rigs) QC & hardware.
 */
export async function GET(request: Request) {
  const me = await requireRole(...VIEW_ROLES);
  const q = new URL(request.url).searchParams;
  // The Dashboard form's names (rfrom, rto, …) win; plain names (from, to, …) also work.
  const filter = pickFilter((k) => q.get(`r${k}`) ?? q.get(k) ?? undefined, new Date());
  const store = storeForAll(me.role);
  const [items, events, hubs, people, qcChecks, hardwareUpdates] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("hubs"),
    store.list("people"),
    store.list("qc_checks").catch(() => [] as QcCheck[]),
    store.list("hardware_updates").catch(() => [] as HardwareUpdate[]),
  ]);
  const report = buildMonthlyReport({ filter, items, events, hubs, people, qcChecks, hardwareUpdates });
  const file = buildXlsx(report.sheets);
  const name = `Inventory-report-${filter.from}-to-${filter.to}.xlsx`;
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
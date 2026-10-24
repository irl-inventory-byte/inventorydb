import { VIEW_ROLES, storeForAll } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import { buildMonthlyReport, pickMonth } from "@/lib/monthly-report";
import type { HardwareUpdate, QcCheck } from "@/lib/schema";
import { buildXlsx } from "@/lib/xlsx";

/**
 * Download the monthly report as an Excel file: GET /api/monthly-report?month=2026-10
 * Every item type the login can see (SD cards, rigs, mobiles). Sheets: Summary, Movements this month,
 * By person this month, By hub now, All items, and (rigs) QC & hardware.
 */
export async function GET(request: Request) {
  const me = await requireRole(...VIEW_ROLES);
  const month = pickMonth(new URL(request.url).searchParams.get("month") ?? undefined, new Date());
  const store = storeForAll(me.role);
  const [items, events, hubs, people, qcChecks, hardwareUpdates] = await Promise.all([
    store.list("items"),
    store.list("events"),
    store.list("hubs"),
    store.list("people"),
    store.list("qc_checks").catch(() => [] as QcCheck[]),
    store.list("hardware_updates").catch(() => [] as HardwareUpdate[]),
  ]);
  const report = buildMonthlyReport({ month, items, events, hubs, people, qcChecks, hardwareUpdates });
  const file = buildXlsx(report.sheets);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Inventory-report-${month}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
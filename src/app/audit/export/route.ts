import { storeFor } from "@/lib/access";
import { requireRole } from "@/lib/authz";
import type { HardwareUpdate, QcCheck } from "@/lib/schema";
import { auditCsv, buildAuditEntries, filterAuditEntries, readAuditFilter } from "@/lib/rig-audit";
import { istDate } from "@/lib/time";

/**
 * Download the QC & hardware audit trail as CSV:
 *   GET /rigs/audit/export?from=2026-10-01&to=2026-10-27&kind=qc&result=fail&person=…&q=IC-6
 * Every filter is optional and matches the report page, so the file holds exactly
 * the rows the page is showing (all of them, not just the page on screen).
 */
export async function GET(request: Request) {
  const user = await requireRole("admin", "im", "hardware", "qc");
  const params = new URL(request.url).searchParams;
  const filter = readAuditFilter((key) => params.get(key) ?? "");

  const store = storeFor(user.role, "rig");
  const [items, qcChecks, hardwareUpdates] = await Promise.all([
    store.list("items"),
    store.list("qc_checks").catch(() => [] as QcCheck[]),
    store.list("hardware_updates").catch(() => [] as HardwareUpdate[]),
  ]);

  const entries = filterAuditEntries(buildAuditEntries({ items, qcChecks, hardwareUpdates }), filter);
  const span = filter.from || filter.to ? `-${filter.from || "start"}-to-${filter.to || "now"}` : "";
  const name = `Rig-audit-trail${span}-${istDate(new Date())}.csv`;

  // The BOM keeps Excel from mangling non-ASCII names and comments.
  return new Response("﻿" + auditCsv(entries), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
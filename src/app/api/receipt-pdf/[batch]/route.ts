import { headers } from "next/headers";
import { requireRole } from "@/lib/authz";
import { summarizeBatch } from "@/lib/receipt";
import { buildReceiptPdf } from "@/lib/receipt-archive";
import { VIEW_ROLES, storeForAll } from "@/lib/access";

/**
 * Download a receipt as a PDF.
 * GET /api/receipt-pdf/<batch>           -> downloads the file
 * GET /api/receipt-pdf/<batch>?view=1    -> opens it in the browser
 * Everyone who can sign in (admin, IM, rig team) may download.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ batch: string }> }
) {
  const me = await requireRole(...VIEW_ROLES);

  const { batch } = await params;
  const batchId = decodeURIComponent(batch);

  const store = storeForAll(me.role);
  const [events, items, hubs] = await Promise.all([
    store.list("events"),
    store.list("items"),
    store.list("hubs"),
  ]);

  const summary = summarizeBatch(events, items, hubs, batchId);
  if (!summary) {
    return new Response(`Receipt ${batchId} was not found.`, { status: 404 });
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const receiptUrl = `${proto}://${host}/handover/receipt/${encodeURIComponent(batchId)}`;

  const pdf = await buildReceiptPdf(summary, receiptUrl);

  // "<receiver> - <date> - <batch>.pdf", same as the copy saved in Drive.
  const person =
    (summary.toName || "Receipt").replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) ||
    "Receipt";
  const t = Date.parse(summary.occurredAt);
  const date = Number.isNaN(t)
    ? summary.occurredAt.slice(0, 10)
    : new Date(t).toLocaleDateString("en-GB", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
  const fileName = `${person} - ${date} - ${batchId}.pdf`;

  const inline = new URL(request.url).searchParams.get("view") === "1";

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
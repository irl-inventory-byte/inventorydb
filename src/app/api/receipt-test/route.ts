import { headers } from "next/headers";
import { requireRole } from "@/lib/authz";
import { getStore } from "@/lib/store";
import { saveReceipt } from "@/lib/receipt-archive";

// Admin-only check for the receipt archive.
// Open /api/receipt-test in the browser to save the latest send's receipt,
// or /api/receipt-test?batch=b-xxxx for a specific batch.
// Shows exactly which step fails (PDF, Drive upload or Sheet).
export async function GET(request: Request) {
  await requireRole("admin");

  let batch = new URL(request.url).searchParams.get("batch") ?? "";

  if (!batch) {
    const events = await getStore().list("events");
    const latestSend = events
      .filter((e) => e.action === "check_out" && e.batch_id)
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
    batch = latestSend?.batch_id ?? "";
  }

  if (!batch) {
    return Response.json({ ok: false, error: "No sent batches found." });
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  try {
    const result = await saveReceipt(batch, `${proto}://${host}`);
    return Response.json({ ok: true, batch, ...result });
  } catch (error) {
    return Response.json({
      ok: false,
      batch,
      serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "(not set)",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

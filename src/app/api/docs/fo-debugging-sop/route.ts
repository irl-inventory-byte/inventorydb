import { requireRole } from "@/lib/authz";
import { VIEW_ROLES } from "@/lib/access";
import { foDebuggingSopPdf } from "@/lib/handover-docs/fo-debugging-sop";

export async function GET() {
  await requireRole(...VIEW_ROLES);

  return new Response(new Uint8Array(foDebuggingSopPdf()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="FO-Debugging-SOP.pdf"',
      "Cache-Control": "private, max-age=3600",
    },
  });
}

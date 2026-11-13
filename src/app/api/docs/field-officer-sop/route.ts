import { requireRole } from "@/lib/authz";
import { VIEW_ROLES } from "@/lib/access";
import { fieldOfficerSopPdf } from "@/lib/handover-docs/field-officer-sop";

export async function GET() {
  await requireRole(...VIEW_ROLES);

  return new Response(new Uint8Array(fieldOfficerSopPdf()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Field-Officer-SOP.pdf"',
      "Cache-Control": "private, max-age=3600",
    },
  });
}

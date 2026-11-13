import { requireRole } from "@/lib/authz";
import { VIEW_ROLES } from "@/lib/access";
import { powerBankFieldGuidePdf } from "@/lib/handover-docs/power-bank-field-guide";

export async function GET() {
  await requireRole(...VIEW_ROLES);

  return new Response(new Uint8Array(powerBankFieldGuidePdf()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Power-Bank-Field-Guide.pdf"',
      "Cache-Control": "private, max-age=3600",
    },
  });
}

import { requireRole } from "@/lib/authz";
import { VIEW_ROLES } from "@/lib/access";
import { assetHandoverPosterPdf } from "@/lib/asset-handover-poster";

export async function GET() {
  await requireRole(...VIEW_ROLES);

  return new Response(new Uint8Array(assetHandoverPosterPdf()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Asset-Handover-and-Custody-Notice.pdf"',
      "Cache-Control": "private, max-age=3600",
    },
  });
}

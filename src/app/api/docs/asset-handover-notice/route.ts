import { assetHandoverPosterPdf } from "@/lib/asset-handover-poster";

// Public on purpose, no login required: this is linked straight from the receipt email, which goes to
// FOs/IFOs who often have no app login at all. Requiring a role here was why the link bounced them to
// the login page and then on to the dashboard instead of opening the PDF.
export async function GET() {
  return new Response(new Uint8Array(assetHandoverPosterPdf()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Asset-Handover-and-Custody-Notice.pdf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
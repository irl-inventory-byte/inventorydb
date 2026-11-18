import { fieldOfficerSopPdf } from "@/lib/handover-docs/field-officer-sop";

// Public on purpose, no login required: this is linked straight from the receipt email, which goes to
// FOs/IFOs who often have no app login at all. Requiring a role here was why the link bounced them to
// the login page and then on to the dashboard instead of opening the PDF.
export async function GET() {
  return new Response(new Uint8Array(fieldOfficerSopPdf()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="Field-Officer-SOP.pdf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
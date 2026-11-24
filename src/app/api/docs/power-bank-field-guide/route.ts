import { powerBankFieldGuidePdf } from "@/lib/handover-docs/power-bank-field-guide";

// Public on purpose, no login required: this is linked straight from the receipt email, which goes to
// FOs/IFOs who often have no app login at all. Requiring a role here was why the link bounced them to
// the login page and then on to the dashboard instead of opening the PDF.
//
// Content-Disposition is "attachment" (not "inline"): Chrome's built-in PDF viewer fails to render an
// inline PDF when the browser is signed into a managed/work Google account, so whether this opened
// depended on which mail account the person was signed into when they tapped the link. Forcing a
// download sidesteps that renderer entirely and opens reliably from any account.
export async function GET() {
  return new Response(new Uint8Array(powerBankFieldGuidePdf()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="Power-Bank-Field-Guide.pdf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
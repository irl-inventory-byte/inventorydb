/**
 * The exact acknowledgment wording, shared by the receipt email (lib/receipt-email.ts) and the
 * confirmation page (app/handover/ack/[token]/page.tsx) so both read identically.
 */
export function acknowledgmentText(handedOverBy: string): string {
  return (
    `I acknowledge that I have received the items listed above in satisfactory condition, handed over by ${handedOverBy || "—"}. ` +
    "I understand that if I cause any damage to these items, I am liable for the penalty amounts stated in the Asset Handover and Custody Notice."
  );
}

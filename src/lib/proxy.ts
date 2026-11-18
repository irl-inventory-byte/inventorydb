import NextAuth from "next-auth";
import { authConfig } from "../auth.config";

// Redirects signed-out visitors to /login. Real permission checks happen in
// server code via requireRole(); this is only the first gate.
//
// handover/ack is excluded on purpose: it's the public, token-based acknowledgment link opened from
// a receipt email (see app/handover/ack/[token]/page.tsx) — the token in the URL is the credential,
// like an unsubscribe link, and the person clicking it may have no login at all.
//
// docs is excluded too: it's public/docs/, the reference-document PDFs (Asset Handover & Custody
// Notice, Power Bank Field Guide, Field Officer SOP, FO Debugging SOP) linked from receipt emails —
// anyone the receipt is sent to needs to open them with no login, the same as handover/ack.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api/auth|login|handover/ack|docs|_next/static|_next/image|favicon.ico).*)"],
};
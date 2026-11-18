import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Redirects signed-out visitors to /login. Real permission checks happen in
// server code via requireRole(); this is only the first gate.
//
// handover/ack is excluded on purpose: it's the public, token-based acknowledgment link opened from
// a receipt email (see app/handover/ack/[token]/page.tsx) — the token in the URL is the credential,
// like an unsubscribe link, and the person clicking it may have no login at all.
//
// api/docs is excluded for the same reason: the SOP/notice PDF links in that same receipt email
// (see lib/receipt-email.ts) go to FOs/IFOs who often have no app login either. Those 4 routes
// themselves were already made public (no requireRole), but this proxy runs BEFORE any route
// handler and was still redirecting to /login first — removing requireRole alone couldn't fix it
// without excluding the path here too.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api/auth|api/docs|login|handover/ack|_next/static|_next/image|favicon.ico).*)"],
};
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Redirects signed-out visitors to /login. Real permission checks happen in
// server code via requireRole(); this is only the first gate.
//
// handover/ack is excluded on purpose: it's the public, token-based acknowledgment link opened from
// a receipt email (see app/handover/ack/[token]/page.tsx) — the token in the URL is the credential,
// like an unsubscribe link, and the person clicking it may have no login at all.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/((?!api/auth|login|handover/ack|_next/static|_next/image|favicon.ico).*)"],
};
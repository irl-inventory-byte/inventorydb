import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "../auth.config";

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
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const res = NextResponse.next();

  // Belt-and-braces against "click any power bank, see a different item's (a rig's) data": the page
  // itself is already force-dynamic (never statically cached by Next itself), but a CDN/edge cache
  // sitting in front of it could still be caching the rendered HTML response by URL and serving a
  // stale one. This forces every /inventory/<id> response to be explicitly uncacheable everywhere —
  // browser, CDN, and any proxy in between — so if that was the cause, this rules it out.
  if (req.nextUrl.pathname.startsWith("/inventory/")) {
    res.headers.set("Cache-Control", "no-store, must-revalidate");
  }

  return res;
});

export const config = {
  matcher: ["/((?!api/auth|api/docs|login|handover/ack|_next/static|_next/image|favicon.ico).*)"],
};
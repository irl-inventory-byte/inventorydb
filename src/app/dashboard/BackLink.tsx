"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * "← Back": goes back to whatever page the person actually came from (e.g. the Dashboard, or an
 * Inventory search they were on) by using the browser's own history, instead of always landing on
 * Home. Falls back to Home only when there's nothing to go back to — a fresh tab, a bookmarked or
 * shared link, or a page opened in a new tab — so it's never a dead end.
 */
export default function BackLink() {
  const router = useRouter();
  return (
    <Link
      href="/"
      onClick={(e) => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      ← Back
    </Link>
  );
}
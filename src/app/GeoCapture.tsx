"use client";

import { useEffect } from "react";

// Only asks once per browser tab — without this, navigating between pages after login would pop the
// browser's location prompt again on every single page.
const SESSION_FLAG = "geo-capture-done";

/**
 * Render this once on the Home/Dashboard page (the page a login lands on right after signing in).
 * On mount, asks the browser for the user's location; if they allow it, posts the coordinates to
 * /api/login-location, which reverse-geocodes them and logs who signed in, from where, and when.
 *
 * If the person declines the browser's permission prompt, or their browser has no geolocation
 * support, nothing is sent and nothing is shown — sign-in is never blocked or slowed by this.
 */
export default function GeoCapture() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_FLAG)) return;
    } catch {
      // sessionStorage unavailable — fall through and ask anyway; worst case it asks again later.
    }

    if (!("geolocation" in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          sessionStorage.setItem(SESSION_FLAG, "1");
        } catch {
          // Best-effort only.
        }
        fetch("/api/login-location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        }).catch(() => {
          // Silent — a failed log write should never show an error to the person signing in.
        });
      },
      () => {
        // Denied, timed out, or unavailable — remember we asked so we don't ask again this tab.
        try {
          sessionStorage.setItem(SESSION_FLAG, "1");
        } catch {
          // Best-effort only.
        }
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  }, []);

  return null;
}
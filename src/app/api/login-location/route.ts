import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStore } from "@/lib/store";
import type { LoginLocation } from "@/lib/schema";
import { istTimestamp } from "@/lib/time";

// Best-effort reverse geocode via OpenStreetMap's free Nominatim API (no API key needed). Nominatim's
// usage policy requires a real identifying User-Agent and caps free use at ~1 request/second, which is
// fine here — this only runs once per sign-in, not per page view.
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`,
      { headers: { "User-Agent": "inventorydb (asset inventory app)" }, cache: "no-store" },
    );
    if (!res.ok) return "";
    const data = (await res.json()) as { display_name?: string; address?: Record<string, string> };
    const a = data.address ?? {};
    const area = a.suburb || a.neighbourhood || a.city_district || "";
    const city = a.city || a.town || a.village || a.county || "";
    const state = a.state || "";
    // "Area, City, State" when we have the parts, else fall back to Nominatim's own full line.
    const parts = [area, city, state].filter(Boolean);
    return parts.length ? parts.join(", ") : data.display_name ?? "";
  } catch {
    return "";
  }
}

// Called once right after a successful sign-in (see app/GeoCapture.tsx), only if the browser's
// location permission prompt was granted. Logs where each login happened — nothing is stored if the
// person declines the prompt, since GeoCapture then never calls this route at all.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { latitude?: unknown; longitude?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: "latitude and longitude are required numbers." }, { status: 400 });
  }

  const address = await reverseGeocode(latitude, longitude);

  const row: LoginLocation = {
    login_location_id: `ll_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    email: session.user.email,
    role: session.user.role ?? "",
    latitude: String(latitude),
    longitude: String(longitude),
    address,
    recorded_at: istTimestamp(),
  };

  try {
    await getStore().appendRows("login_locations", [row]);
  } catch (e) {
    // Don't fail the sign-in experience over a logging table being missing/misconfigured —
    // just report it so it's visible in Vercel logs.
    console.error("login_locations write failed:", e);
    return NextResponse.json({ error: "Could not save location." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, address });
}
import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { geocodingConfigured, reverseGeocode } from "@/lib/wfm/geocode";

/**
 * Admin-only: what does Ola Maps ACTUALLY return for a coordinate?
 *
 * The address lookup fails silently by design -- a geocoding outage must
 * never break the punch audit, so it just draws coordinates. That is the
 * right behaviour for an employee and a terrible one for whoever has to
 * work out why no address ever appears: "key missing", "key rejected",
 * "provider has no address here" and "we parsed the response wrong" all
 * look identical from the outside.
 *
 * This returns the raw provider response alongside our parse of it, so the
 * four are distinguishable in one call. The API key is never echoed.
 *
 * GET /api/wfm/geocode/diagnose?lat=13.61713&lng=77.51772
 */
export async function GET(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  void tenantId;

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const key = process.env.OLA_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json({
      configured: false,
      verdict: "OLA_MAPS_API_KEY is not set in this environment.",
    });
  }

  // The same request reverseGeocode() makes, so the raw body below is
  // exactly what the parser was given.
  const url =
    `https://api.olamaps.io/places/v1/reverse-geocode` +
    `?latlng=${encodeURIComponent(`${lat},${lng}`)}&api_key=${encodeURIComponent(key)}`;

  let status: number | null = null;
  let raw: unknown = null;
  let rawText: string | null = null;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
    status = res.status;
    rawText = (await res.text()).slice(0, 4000);
    try { raw = JSON.parse(rawText); } catch { /* keep the text */ }
  } catch (e) {
    return NextResponse.json({
      configured: true,
      http_status: null,
      verdict: `Could not reach Ola Maps: ${(e as Error).message}`,
    });
  }

  const parsed = await reverseGeocode(lat, lng);

  const verdict =
    status !== 200 ? `Ola Maps rejected the request with HTTP ${status} — check the key and that Places is enabled for it.`
    : parsed.status === "ok" ? "Working. Addresses should appear on the punch audit."
    : parsed.status === "empty" ? "Ola answered 200 but our parser found no address in it — compare `raw` against what the parser reads (results[0].formatted_address)."
    : `Call failed: ${parsed.reason}`;

  return NextResponse.json({
    configured: geocodingConfigured(),
    http_status: status,
    parsed,
    verdict,
    raw: raw ?? rawText,
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";

/**
 * Admin-only: what does Ola Maps ACTUALLY say, and to which endpoint?
 *
 * The address lookup fails silently by design -- a geocoding outage must
 * never break the punch audit, so it just draws coordinates. That is right
 * for an employee and useless for whoever has to debug it: key missing, key
 * rejected, no address at that point, and "we parsed the response wrong"
 * all look identical from the outside.
 *
 * This calls BOTH endpoints with the same key and reports the raw bodies
 * plus key hygiene, because the two results together say what one cannot:
 *
 *   both 401          -> the key itself is refused: wrong value, or
 *                        restricted to referers/domains that a server-side
 *                        call can never satisfy.
 *   forward ok, reverse 401 -> the key is fine; the Places/reverse-geocode
 *                        product is not enabled on it.
 *   both ok           -> the problem was never auth; look at parsing.
 *
 * The key is never echoed -- only its length and whether it had whitespace
 * around it, which is enough to catch the most common cause of a 401 on a
 * key that looks perfect in a dashboard.
 *
 * GET /api/wfm/geocode/diagnose?lat=13.61713&lng=77.51772
 */

const TIMEOUT_MS = 6000;

async function probe(url: string): Promise<{ http_status: number | null; body: unknown }> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = (await res.text()).slice(0, 3000);
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* keep the text */ }
    return { http_status: res.status, body };
  } catch (e) {
    return { http_status: null, body: `Could not reach Ola Maps: ${(e as Error).message}` };
  }
}

export async function GET(request: NextRequest) {
  let role;
  try {
    ({ role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const rawKey = process.env.OLA_MAPS_API_KEY ?? "";
  const key = rawKey.trim();
  if (!key) return NextResponse.json({ configured: false, verdict: "OLA_MAPS_API_KEY is not set in this environment." });

  const k = encodeURIComponent(key);
  const [reverse, forward] = await Promise.all([
    probe(`https://api.olamaps.io/places/v1/reverse-geocode?latlng=${encodeURIComponent(`${lat},${lng}`)}&api_key=${k}`),
    probe(`https://api.olamaps.io/places/v1/geocode?address=${encodeURIComponent("Hosapete, Karnataka")}&api_key=${k}`),
  ]);

  const verdict =
    reverse.http_status === 200 && forward.http_status === 200
      ? "Both endpoints answered. Auth is fine — if addresses still don't show, it's the parsing."
      : reverse.http_status === 401 && forward.http_status === 401
      ? "The key itself is being refused on BOTH endpoints. Either the value is wrong, or the key is restricted to domains/referers — a server-side call sends no referer, so a domain-restricted key can never pass. Make it unrestricted (or IP-restricted) in the Ola console."
      : forward.http_status === 200 && reverse.http_status !== 200
      ? "The key works for forward geocoding but not reverse — so it is valid and the reverse-geocode/Places product is not enabled on it. Enable it in the Ola console."
      : `Reverse returned ${reverse.http_status}, forward returned ${forward.http_status}.`;

  return NextResponse.json({
    configured: true,
    key_length: key.length,
    key_had_surrounding_whitespace: rawKey !== key,
    reverse,
    forward,
    verdict,
  });
}

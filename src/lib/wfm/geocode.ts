import "server-only";

// Reverse geocoding: GPS fix -> human-readable address.
//
// Provider-agnostic on purpose. Ola Maps is the shipped implementation
// (chosen 2026-08-06: 5M calls/month free, India-first, and an Indian
// provider keeps employee location data in-country, which matters under
// DPDP). Swapping to Mappls or Google should be a new `case` here plus an
// env var, never a change at the call site.
//
// The API key is server-side only and must never reach the client bundle --
// it's a billable credential, and Ola's key is passed as a query parameter,
// so a leaked one is trivially abusable.

export type GeocodeResult =
  /** Provider answered with an address. */
  | { status: "ok"; address: string }
  /** Provider answered, but has no address for those coordinates. Cached as
   *  "" so we never re-ask for the same dead point. */
  | { status: "empty" }
  /** Not configured, or the call failed. NOT cached -- worth retrying. */
  | { status: "unavailable"; reason: string };

const TIMEOUT_MS = 4000;

export function geocodingConfigured(): boolean {
  return !!process.env.OLA_MAPS_API_KEY;
}

/**
 * Resolve one coordinate pair to an address. Never throws: a geocoding
 * failure must never break the screen that's merely trying to label a
 * punch, so every error path returns `unavailable` and the caller renders
 * coordinates instead.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult> {
  const key = process.env.OLA_MAPS_API_KEY;
  if (!key) return { status: "unavailable", reason: "OLA_MAPS_API_KEY is not set" };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { status: "unavailable", reason: "Invalid coordinates" };
  }

  const url =
    `https://api.olamaps.io/places/v1/reverse-geocode` +
    `?latlng=${encodeURIComponent(`${lat},${lng}`)}&api_key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { status: "unavailable", reason: `Ola Maps returned ${res.status}` };
    }
    const json = (await res.json()) as {
      results?: { formatted_address?: string; name?: string }[];
    };

    // Defensive: Ola's shape mirrors Google's (results[].formatted_address),
    // but this is parsed leniently rather than assumed, since the response
    // couldn't be verified against a live key from here.
    const first = json.results?.[0];
    const address = (first?.formatted_address || first?.name || "").trim();
    return address ? { status: "ok", address } : { status: "empty" };
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "Ola Maps timed out" : "Could not reach Ola Maps";
    return { status: "unavailable", reason };
  }
}

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
  return !!olaKey();
}

/** Trimmed, because a key pasted into a dashboard with a trailing newline or
 *  space looks perfectly correct there and is rejected 401 by the provider
 *  every single time -- the encoded whitespace travels in the query string. */
function olaKey(): string {
  return (process.env.OLA_MAPS_API_KEY ?? "").trim();
}

/**
 * Resolve one coordinate pair to an address. Never throws: a geocoding
 * failure must never break the screen that's merely trying to label a
 * punch, so every error path returns `unavailable` and the caller renders
 * coordinates instead.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult> {
  const key = olaKey();
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

export type ForwardGeocodeResult =
  /** Provider found a coordinate for that address. */
  | { status: "ok"; lat: number; lng: number; formatted_address: string }
  /** Provider answered but found nothing for that text. */
  | { status: "empty" }
  /** Not configured, or the call failed. */
  | { status: "unavailable"; reason: string };

/**
 * Resolve free-text (an address, a place name) to a coordinate -- the
 * inverse of reverseGeocode(). Used by the site-picker so an admin can type
 * an address instead of hunting for it on the map; the returned point is
 * always shown as a draggable pin so it can still be fine-tuned, since a
 * geocoder's idea of "the building" and the actual gate/entrance can differ
 * by tens of metres. Never throws, same contract as reverseGeocode.
 */
export async function forwardGeocode(address: string): Promise<ForwardGeocodeResult> {
  const key = olaKey();
  if (!key) return { status: "unavailable", reason: "OLA_MAPS_API_KEY is not set" };
  const q = address.trim();
  if (!q) return { status: "unavailable", reason: "Empty address" };

  const url =
    `https://api.olamaps.io/places/v1/geocode` +
    `?address=${encodeURIComponent(q)}&api_key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return { status: "unavailable", reason: `Ola Maps returned ${res.status}` };
    }
    const json = (await res.json()) as {
      geocodingResults?: { formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } } }[];
      results?: { formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } } }[];
    };

    // Parsed leniently, same caveat as reverseGeocode: Ola's geocode shape
    // wasn't verifiable against a live key from here, so both its own
    // documented field name and the Google-compatible fallback are tried.
    const first = json.geocodingResults?.[0] ?? json.results?.[0];
    const lat = first?.geometry?.location?.lat;
    const lng = first?.geometry?.location?.lng;
    if (typeof lat !== "number" || typeof lng !== "number") return { status: "empty" };
    return { status: "ok", lat, lng, formatted_address: (first?.formatted_address || q).trim() };
  } catch (e) {
    const reason = e instanceof Error && e.name === "TimeoutError" ? "Ola Maps timed out" : "Could not reach Ola Maps";
    return { status: "unavailable", reason };
  }
}

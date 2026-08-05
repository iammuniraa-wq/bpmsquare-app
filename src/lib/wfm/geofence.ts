// Pure geofence math — no server/DB imports, so it's directly unit-testable
// (moved out of server.ts, which pulls in supabase-server.ts and is
// therefore awkward to import from a plain test runner).

import type { WfmSite } from "./types";

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Match a punch location against the tenant's active sites. Policy: outside
 * every geofence is flagged, never rejected.
 */
export function matchSite(
  sites: WfmSite[],
  lat: number | null,
  lng: number | null
): { site: WfmSite | null; within: boolean | null } {
  if (lat == null || lng == null) return { site: null, within: null };
  let nearest: WfmSite | null = null;
  let nearestDist = Infinity;
  for (const s of sites) {
    if (!s.active) continue;
    const d = haversineMeters(lat, lng, s.lat, s.lng);
    if (d < nearestDist) {
      nearest = s;
      nearestDist = d;
    }
  }
  if (nearest && nearestDist <= nearest.radius_m) return { site: nearest, within: true };
  return { site: nearest, within: false };
}

import { bucketOf } from "@/lib/crew/attendance/adapters";
import type { DistanceBucket, PunchFlagKind, PunchFlagRow } from "@/lib/crew/attendance/facts";
import { haversineMeters } from "./geofence";
import { shiftDayKey, type ShiftDayInfo } from "./hours";

// The pure core of the flagged-punch reader (see crewReads.ts): no database, so it is unit-tested.

const FLAG_KINDS: readonly PunchFlagKind[] = ["outside_geofence", "no_location", "low_accuracy", "face_mismatch", "selfie_required"];
export type EventLike = { employee_id: string; ts: string; flags: Record<string, unknown> | null; geo_lat: number | null; geo_lng: number | null };
export type SitePin = { lat: number; lng: number; radius_m: number };

/**
 * Pure: flagged punches -> one row per flagged punch. The distance of an outside-the-boundary punch is measured from the pin of the site the person is
 * assigned to that day (the roster row, else their home site) and reported only as a bucket of the radius; the coordinates never leave this function.
 */
export function flagRowsFromEvents(
  events: readonly EventLike[],
  ctx: {
    timezone: string; from: string; to: string;
    shiftOf: (employeeId: string) => ShiftDayInfo;
    siteFor: (employeeId: string, date: string) => SitePin | null;
  },
): PunchFlagRow[] {
  const out: PunchFlagRow[] = [];
  for (const e of events) {
    const flags = FLAG_KINDS.filter((k) => (e.flags ?? {})[k] === true);
    if (flags.length === 0) continue;
    const date = shiftDayKey(new Date(e.ts), ctx.timezone, ctx.shiftOf(e.employee_id));
    if (date < ctx.from || date > ctx.to) continue;
    let bucket: DistanceBucket | null = null;
    if (flags.includes("outside_geofence") && e.geo_lat != null && e.geo_lng != null) {
      const pin = ctx.siteFor(e.employee_id, date);
      if (pin) bucket = bucketOf(haversineMeters(e.geo_lat, e.geo_lng, pin.lat, pin.lng), pin.radius_m);
    }
    out.push({ employee_id: e.employee_id, date, flags, distance_bucket: bucket });
  }
  return out;
}


import { describe, expect, it } from "vitest";
import { flagRowsFromEvents, type EventLike } from "./punchFlags";

// The flagged-punch reader keeps the one fact the Attendance agent needs from a punch (the shift-day, the kinds of flag and how far outside the boundary)
// and nothing else: no coordinate, no time, no selfie. Pure core, no database.

const pin = { lat: 12.9716, lng: 77.5946, radius_m: 100 };
const ev = (over: Partial<EventLike> = {}): EventLike => ({ employee_id: "e1", ts: "2026-10-27T04:00:00Z", flags: { outside_geofence: true }, geo_lat: pin.lat + 0.0015, geo_lng: pin.lng, ...over });
const ctx = (over: Record<string, unknown> = {}) => ({ timezone: "Asia/Kolkata", from: "2026-10-20", to: "2026-11-02", shiftOf: () => null, siteFor: () => pin, ...over });

describe("flagRowsFromEvents", () => {
  it("keeps only flagged punches and reports the shift-day, the flags and a distance bucket", () => {
    const rows = flagRowsFromEvents([ev(), ev({ flags: {} }), ev({ flags: null })], ctx());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ employee_id: "e1", date: "2026-10-27", flags: ["outside_geofence"], distance_bucket: "1.5-3x" });
  });

  it("never carries a coordinate, a timestamp or a selfie path", () => {
    const json = JSON.stringify(flagRowsFromEvents([ev()], ctx()));
    expect(json).not.toMatch(/12\.97|77\.59|"(ts|geo_lat|geo_lng|lat|lng|selfie_path)"/);
    expect(Object.keys(flagRowsFromEvents([ev()], ctx())[0]).sort()).toEqual(["date", "distance_bucket", "employee_id", "flags"]);
  });

  it("buckets by the radius: inside 1.5x, between 1.5x and 3x, beyond 3x", () => {
    const at = (metersNorth: number) => flagRowsFromEvents([ev({ geo_lat: pin.lat + metersNorth / 111_195 })], ctx())[0].distance_bucket;
    expect(at(120)).toBe("<1.5x");
    expect(at(200)).toBe("1.5-3x");
    expect(at(400)).toBe(">3x");
  });

  it("measures from the pin of the site the person is assigned to that day", () => {
    const far = { lat: pin.lat + 0.05, lng: pin.lng, radius_m: 100 };
    const rows = flagRowsFromEvents([ev({ geo_lat: far.lat, geo_lng: far.lng })], ctx({ siteFor: (_id: string, date: string) => (date === "2026-10-27" ? far : pin) }));
    expect(rows[0].distance_bucket).toBe("<1.5x");
  });

  it("gives no bucket when there is no coordinate or no site to measure from, and other flags have none", () => {
    expect(flagRowsFromEvents([ev({ geo_lat: null, geo_lng: null, flags: { outside_geofence: true, no_location: true } })], ctx())[0]).toMatchObject({ distance_bucket: null, flags: ["outside_geofence", "no_location"] });
    expect(flagRowsFromEvents([ev()], ctx({ siteFor: () => null }))[0].distance_bucket).toBeNull();
    expect(flagRowsFromEvents([ev({ flags: { low_accuracy: true } })], ctx())[0]).toMatchObject({ flags: ["low_accuracy"], distance_bucket: null });
  });

  it("puts a night shift's tail on the day the shift started, and drops punches outside the range", () => {
    const night = { start_time: "21:00:00", crosses_midnight: true };
    const rows = flagRowsFromEvents([ev({ ts: "2026-10-27T23:30:00Z" })], ctx({ shiftOf: () => night }));
    // 23:30 UTC is 05:00 on the 28th in Kolkata, before the 21:00 start: it belongs to the 27th.
    expect(rows[0].date).toBe("2026-10-27");
    expect(flagRowsFromEvents([ev({ ts: "2026-10-01T04:00:00Z" })], ctx())).toEqual([]);
    expect(flagRowsFromEvents([ev({ ts: "2026-11-09T04:00:00Z" })], ctx())).toEqual([]);
  });
});

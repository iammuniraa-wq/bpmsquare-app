import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PunchList, selfieNote } from "./PunchAudit";

const NOW = new Date("2026-11-05T09:00:00Z").getTime();
const recent = "2026-11-04T04:00:00Z";
const old = "2026-08-01T04:00:00Z";

const base = {
  id: "e1", kind: "check_in" as const, ts: recent, source: "web_selfie", site_name: null,
  geo_lat: null, geo_lng: null, geo_accuracy_m: null, within_geofence: null, geo_address: null, selfie_url: null,
};
const html = (events: object[], retentionDays: number | null = 60) =>
  renderToStaticMarkup(createElement(PunchList, { events: events as never, retentionDays, now: NOW }));

describe("PunchAudit: where a punch was recorded", () => {
  it("says a kiosk punch was recorded at the kiosk, with the site, address, pin and map link, and no warning", () => {
    const out = html([{
      ...base, source: "kiosk_face", site_name: "Plant 1", within_geofence: true,
      site_pin: { lat: 12.9716, lng: 77.5946, name: "Plant 1", address: "Plot 4, Industrial Area" },
    }]);
    expect(out).toContain("Recorded at the kiosk at Plant 1");
    expect(out).toContain("Plot 4, Industrial Area");
    expect(out).toContain("Site location (not a GPS fix): 12.97160, 77.59460");
    expect(out).toContain("View on map");
    expect(out).toContain("query=12.9716,77.5946");
    expect(out).not.toContain("No location captured");
  });

  it("still reads as recorded at the kiosk when the site pin is missing", () => {
    const out = html([{ ...base, source: "kiosk_face" }]);
    expect(out).toContain("Recorded at the kiosk");
    expect(out).not.toContain("Site location");
    expect(out).not.toContain("No location captured");
  });

  it("says a correction was made by a supervisor with no location, not a fault", () => {
    const out = html([{ ...base, source: "correction" }]);
    expect(out).toContain("Corrected by a supervisor: no location recorded");
    expect(out).not.toContain("No location captured");
  });

  it("keeps the warning for a web or manual punch that really has no coordinates", () => {
    expect(html([{ ...base, source: "web_selfie" }])).toContain("No location captured");
    expect(html([{ ...base, source: "manual" }])).toContain("No location captured");
  });

  it("shows the GPS fix as before when there is one", () => {
    const out = html([{ ...base, geo_lat: 12.5, geo_lng: 77.5, geo_address: "MG Road", geo_accuracy_m: 12 }]);
    expect(out).toContain("MG Road");
    expect(out).toContain("12.50000, 77.50000");
    expect(out).not.toContain("Site location");
  });
});

describe("PunchAudit: a missing selfie", () => {
  it("says the selfie was removed once the punch is older than the retention window", () => {
    expect(html([{ ...base, ts: old }])).toContain("Selfie removed after 60 days");
  });

  it("says no selfie for a recent punch, or when the retention is unknown", () => {
    expect(html([{ ...base }])).toContain("no selfie");
    expect(html([{ ...base }])).not.toContain("removed");
    expect(html([{ ...base, ts: old }], null)).toContain("no selfie");
  });

  it("never claims a supervisor correction had its selfie removed", () => {
    expect(selfieNote({ ts: old, source: "correction" }, 60, NOW)).toBe("no selfie");
  });

  it("shows the selfie itself when there is one", () => {
    expect(html([{ ...base, ts: old, selfie_url: "https://signed/a.jpg" }])).toContain("https://signed/a.jpg");
  });
});

describe("PunchAudit: an empty day", () => {
  it("says there are no punches", () => {
    expect(html([])).toContain("No punches on this day.");
  });
});

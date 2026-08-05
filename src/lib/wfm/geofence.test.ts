import { describe, it, expect } from "vitest";
import { haversineMeters, matchSite } from "./geofence";
import type { WfmSite } from "./types";

const site = (over: Partial<WfmSite> = {}): WfmSite => ({
  id: "s1", name: "Workshop", lat: 15.2695, lng: 76.3871, radius_m: 150, active: true, ...over,
});

describe("haversineMeters", () => {
  it("returns ~0 for the same point", () => {
    expect(haversineMeters(15.2695, 76.3871, 15.2695, 76.3871)).toBeCloseTo(0, 3);
  });

  it("matches a known distance (~111km per degree of latitude)", () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe("matchSite", () => {
  it("returns within=null when no location is provided", () => {
    expect(matchSite([site()], null, null)).toEqual({ site: null, within: null });
  });

  it("matches within radius", () => {
    const { site: s, within } = matchSite([site()], 15.2695, 76.3871);
    expect(within).toBe(true);
    expect(s?.id).toBe("s1");
  });

  it("flags outside radius but still reports the nearest site -- never rejects", () => {
    // ~1.1km away -- well outside a 150m radius
    const { site: s, within } = matchSite([site()], 15.2795, 76.3871);
    expect(within).toBe(false);
    expect(s?.id).toBe("s1");
  });

  it("ignores inactive sites", () => {
    const { site: s, within } = matchSite([site({ active: false })], 15.2695, 76.3871);
    expect(s).toBeNull();
    expect(within).toBe(false);
  });

  it("picks the nearest of several sites", () => {
    const near = site({ id: "near", lat: 15.2695, lng: 76.3871 });
    const far = site({ id: "far", lat: 16.0, lng: 77.0 });
    const { site: s } = matchSite([far, near], 15.2696, 76.3872);
    expect(s?.id).toBe("near");
  });
});

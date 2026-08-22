import { describe, it, expect } from "vitest";
import { isShiftPunch, locationRequiredFor, selfieRequiredFor } from "./punchRules";
import type { PresenceKind } from "./types";

const ALL_KINDS: PresenceKind[] = [
  "check_in", "check_out", "break_start", "break_end",
  "ot_in", "ot_out",
  "mobile_work_start", "mobile_work_end",
  "business_trip_start", "business_trip_end",
];

describe("locationRequiredFor — shift punches AND breaks, nothing else", () => {
  it("mandates shift punches and breaks", () => {
    for (const k of ["check_in", "check_out", "break_start", "break_end"] as const) {
      expect(locationRequiredFor(k)).toBe(true);
    }
  });
  it("exempts OT and mobile/trip punches", () => {
    for (const k of ALL_KINDS.filter((k) => !isShiftPunch(k) && k !== "break_start" && k !== "break_end")) {
      expect(locationRequiredFor(k)).toBe(false);
    }
  });
});

// Breaks became selfie-gated on 2026-08-22 (owner decision): a break punch
// must behave exactly like a shift punch. Only "off" exempts them now.
describe("selfieRequiredFor — breaks match shift punches", () => {
  it("off: never", () => {
    for (const k of ALL_KINDS) expect(selfieRequiredFor(k, "off")).toBe(false);
  });
  it("shift: in/out + breaks + mobile/trip starts", () => {
    expect(selfieRequiredFor("check_in", "shift")).toBe(true);
    expect(selfieRequiredFor("check_out", "shift")).toBe(true);
    expect(selfieRequiredFor("mobile_work_start", "shift")).toBe(true);
    expect(selfieRequiredFor("business_trip_start", "shift")).toBe(true);
    expect(selfieRequiredFor("break_start", "shift")).toBe(true);
    expect(selfieRequiredFor("break_end", "shift")).toBe(true);
    expect(selfieRequiredFor("ot_in", "shift")).toBe(false);
  });
  it("all: every kind, breaks included", () => {
    for (const k of ALL_KINDS) expect(selfieRequiredFor(k, "all")).toBe(true);
  });
});

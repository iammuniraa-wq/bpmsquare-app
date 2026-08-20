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

describe("selfieRequiredFor — breaks are never selfie-gated, in any mode", () => {
  it("off: never", () => {
    for (const k of ALL_KINDS) expect(selfieRequiredFor(k, "off")).toBe(false);
  });
  it("shift: in/out + mobile/trip starts only", () => {
    expect(selfieRequiredFor("check_in", "shift")).toBe(true);
    expect(selfieRequiredFor("check_out", "shift")).toBe(true);
    expect(selfieRequiredFor("mobile_work_start", "shift")).toBe(true);
    expect(selfieRequiredFor("business_trip_start", "shift")).toBe(true);
    expect(selfieRequiredFor("break_start", "shift")).toBe(false);
    expect(selfieRequiredFor("break_end", "shift")).toBe(false);
    expect(selfieRequiredFor("ot_in", "shift")).toBe(false);
  });
  it("all: everything except breaks", () => {
    expect(selfieRequiredFor("break_start", "all")).toBe(false);
    expect(selfieRequiredFor("break_end", "all")).toBe(false);
    for (const k of ALL_KINDS.filter((k) => k !== "break_start" && k !== "break_end")) {
      expect(selfieRequiredFor(k, "all")).toBe(true);
    }
  });
});

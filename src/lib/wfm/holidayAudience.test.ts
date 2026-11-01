import { describe, it, expect } from "vitest";
import { resolveHolidayAudience } from "./holidayAudience";

const TYPES = [{ code: "full_time", label: "Full-time" }, { code: "intern", label: "Intern" }, { code: "trainee", label: "Trainee" }];

describe("resolveHolidayAudience", () => {
  it("is everyone for blank, all and everyone", () => {
    for (const v of [undefined, "", "all", "All", "Everyone"]) expect(resolveHolidayAudience(v, TYPES)).toEqual({ codes: ["all"] });
  });
  it("takes a code, a label, a list or an array of configured types, one row each", () => {
    expect(resolveHolidayAudience("intern", TYPES)).toEqual({ codes: ["intern"] });
    expect(resolveHolidayAudience("Full-time", TYPES)).toEqual({ codes: ["full_time"] });
    expect(resolveHolidayAudience("intern, Trainee", TYPES)).toEqual({ codes: ["intern", "trainee"] });
    expect(resolveHolidayAudience(["trainee", "trainee", "intern"], TYPES)).toEqual({ codes: ["trainee", "intern"] });
  });
  it("refuses an unknown type instead of widening the holiday to everyone, except the old single select", () => {
    expect(resolveHolidayAudience("ghost", TYPES)).toEqual({ error: "Unknown employment type: ghost" });
    expect(resolveHolidayAudience(["intern", "ghost"], TYPES)).toEqual({ error: "Unknown employment type: ghost" });
    expect(resolveHolidayAudience("ghost", TYPES, true)).toEqual({ codes: ["all"] });
    expect(resolveHolidayAudience([], TYPES)).toEqual({ error: "Choose at least one employment type" });
  });
});

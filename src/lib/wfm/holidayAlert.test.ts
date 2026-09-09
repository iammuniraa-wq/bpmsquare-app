import { describe, it, expect } from "vitest";
import {
  holidayWeekWindow, holidayAppliesTo, holidayDigestBody, holidayDigestTitle,
} from "./holidayAlert";

describe("holidayWeekWindow", () => {
  it("covers today plus the next six days, inclusive", () => {
    expect(holidayWeekWindow("2026-09-14")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });

  it("crosses a month boundary", () => {
    expect(holidayWeekWindow("2026-09-28")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });

  it("crosses a year boundary", () => {
    expect(holidayWeekWindow("2026-12-30")).toEqual({ from: "2026-12-30", to: "2027-01-05" });
  });
});

describe("holidayAppliesTo", () => {
  it("'all' applies to everyone, typed or not", () => {
    expect(holidayAppliesTo("all", "full_time")).toBe(true);
    expect(holidayAppliesTo("all", null)).toBe(true);
  });

  it("a null applies_to is treated as 'all'", () => {
    expect(holidayAppliesTo(null, null)).toBe(true);
  });

  it("a typed holiday reaches only that employment type", () => {
    expect(holidayAppliesTo("contractor", "contractor")).toBe(true);
    expect(holidayAppliesTo("contractor", "full_time")).toBe(false);
  });

  it("an employee with no employment type never matches a typed holiday", () => {
    expect(holidayAppliesTo("contractor", null)).toBe(false);
  });
});

describe("holidayDigestBody", () => {
  it("names the day and the holiday", () => {
    expect(holidayDigestBody([{ date: "2026-09-18", name: "Onam" }])).toBe("Fri 18 Sep — Onam");
  });

  it("lists several in date order regardless of input order", () => {
    expect(
      holidayDigestBody([
        { date: "2026-09-18", name: "Onam" },
        { date: "2026-09-16", name: "Founders Day" },
      ])
    ).toBe("Wed 16 Sep — Founders Day · Fri 18 Sep — Onam");
  });
});

describe("holidayDigestTitle", () => {
  it("is singular for one", () => {
    expect(holidayDigestTitle(1)).toBe("Holiday this week");
  });
  it("counts when there are several", () => {
    expect(holidayDigestTitle(2)).toBe("2 holidays this week");
  });
});

import { describe, it, expect } from "vitest";
import { leaveDaysByMonth, checkMonthlyLimit, paidWithinMonthlyAllowance } from "./leaveRules";

describe("leaveDaysByMonth", () => {
  it("splits a span across months and weights half-days", () => {
    expect(leaveDaysByMonth({ date_from: "2026-09-29", date_to: "2026-10-02", half_day: false })).toEqual({ "2026-09": 2, "2026-10": 2 });
    expect(leaveDaysByMonth({ date_from: "2026-09-10", date_to: "2026-09-10", half_day: true })).toEqual({ "2026-09": 0.5 });
  });
});

describe("checkMonthlyLimit — CompOff at most 1 a month", () => {
  it("allows the first day and refuses the second in the same month", () => {
    expect(checkMonthlyLimit(1, { date_from: "2026-09-05", date_to: "2026-09-05", half_day: false }, [])).toBeNull();
    expect(checkMonthlyLimit(1, { date_from: "2026-09-20", date_to: "2026-09-20", half_day: false }, [
      { date_from: "2026-09-05", date_to: "2026-09-05", half_day: false },
    ])).toEqual({ month: "2026-09", limit: 1, already: 1, requested: 1 });
  });
  it("counts pending requests as already taken, and ignores other months", () => {
    const existing = [{ date_from: "2026-08-30", date_to: "2026-08-30", half_day: false }];
    expect(checkMonthlyLimit(1, { date_from: "2026-09-01", date_to: "2026-09-01", half_day: false }, existing)).toBeNull();
  });
  it("refuses a span that alone exceeds the limit", () => {
    expect(checkMonthlyLimit(1, { date_from: "2026-09-01", date_to: "2026-09-02", half_day: false }, [])?.requested).toBe(2);
  });
  it("is a no-op without a limit", () => {
    expect(checkMonthlyLimit(null, { date_from: "2026-09-01", date_to: "2026-09-30", half_day: false }, [])).toBeNull();
  });
});

describe("paidWithinMonthlyAllowance — Sick paid for 1 day a month", () => {
  it("pays the first day and marks the rest unpaid, in date order", () => {
    const m = paidWithinMonthlyAllowance(1, [
      { date: "2026-09-18", half_day: false },
      { date: "2026-09-03", half_day: false },
      { date: "2026-09-04", half_day: false },
    ]);
    expect(m.get("2026-09-03")).toBe(true);
    expect(m.get("2026-09-04")).toBe(false);
    expect(m.get("2026-09-18")).toBe(false);
  });
  it("lets two half-days fit inside a one-day allowance", () => {
    const m = paidWithinMonthlyAllowance(1, [{ date: "2026-09-03", half_day: true }, { date: "2026-09-10", half_day: true }, { date: "2026-09-11", half_day: true }]);
    expect([m.get("2026-09-03"), m.get("2026-09-10"), m.get("2026-09-11")]).toEqual([true, true, false]);
  });
  it("pays everything when there is no allowance rule", () => {
    expect(paidWithinMonthlyAllowance(null, [{ date: "2026-09-03", half_day: false }]).get("2026-09-03")).toBe(true);
  });
});

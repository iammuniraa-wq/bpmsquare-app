import { describe, it, expect } from "vitest";
import { nthSaturdayOfMonth, isSecondSaturday, saturdaysInMonth } from "./saturdayRule";

const TZ = "Asia/Kolkata";

/** Independent oracle: native UTC weekday math, not the implementation under
 *  test, so a shared bug can't hide behind an assertion that copies it. */
function isSaturdayUTC(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 6;
}

function daysInMonth(yearMonth: string): string[] {
  const [y, m] = yearMonth.split("-").map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${yearMonth}-${String(i + 1).padStart(2, "0")}`);
}

describe("nthSaturdayOfMonth", () => {
  it("returns null for every non-Saturday, across a full year", () => {
    for (const month of Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`)) {
      for (const date of daysInMonth(month)) {
        const nth = nthSaturdayOfMonth(date, TZ);
        expect(nth === null).toBe(!isSaturdayUTC(date));
      }
    }
  });

  it("numbers Saturdays 1-5 in order, resetting each month", () => {
    for (const month of Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`)) {
      const saturdays = daysInMonth(month).filter(isSaturdayUTC);
      saturdays.forEach((date, i) => {
        expect(nthSaturdayOfMonth(date, TZ)).toBe(i + 1);
      });
    }
  });

  it("a month can have 4 or 5 Saturdays, never more or fewer", () => {
    for (const month of Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`)) {
      const count = daysInMonth(month).filter(isSaturdayUTC).length;
      expect(count === 4 || count === 5).toBe(true);
    }
  });
});

describe("isSecondSaturday", () => {
  it("agrees with nthSaturdayOfMonth === 2 for every day in a year", () => {
    for (const month of Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`)) {
      for (const date of daysInMonth(month)) {
        expect(isSecondSaturday(date, TZ)).toBe(nthSaturdayOfMonth(date, TZ) === 2);
      }
    }
  });
});

describe("saturdaysInMonth", () => {
  it("lists exactly the Saturdays daysInMonth would find, each tagged with its occurrence", () => {
    for (const month of ["2026-01", "2026-02", "2026-09", "2026-12"]) {
      const expected = daysInMonth(month).filter(isSaturdayUTC);
      const got = saturdaysInMonth(month, TZ);
      expect(got.map((s) => s.date)).toEqual(expected);
      got.forEach((s, i) => expect(s.nth).toBe(i + 1));
    }
  });

  it("contains exactly one 2nd Saturday per month", () => {
    for (const month of Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`)) {
      const seconds = saturdaysInMonth(month, TZ).filter((s) => s.nth === 2);
      expect(seconds).toHaveLength(1);
    }
  });
});

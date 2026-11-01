import { describe, it, expect } from "vitest";
import {
  cleanSheetName, employmentTypeError, formatSignedHM, otCountedMinutes, shiftMinutes, standardMinutesForDay, uniqueSheetName,
} from "./reportRules";

describe("overtime minimum", () => {
  it("shows but does not count a day under the minimum, and counts a day at or above it in full", () => {
    expect(otCountedMinutes(24, 30)).toBe(0);
    expect(otCountedMinutes(29, 30)).toBe(0);
    expect(otCountedMinutes(30, 30)).toBe(30);
    expect(otCountedMinutes(95, 30)).toBe(95);
  });
  it("a minimum of 0 is the old behaviour: every approved minute counts", () => {
    expect(otCountedMinutes(1, 0)).toBe(1);
    expect(otCountedMinutes(24, 0)).toBe(24);
    expect(otCountedMinutes(0, 30)).toBe(0);
  });
  it("ignores a nonsense minimum", () => {
    expect(otCountedMinutes(10, Number.NaN)).toBe(10);
    expect(otCountedMinutes(10, -5)).toBe(10);
  });
});

describe("Actual Hrs text", () => {
  it("writes a leading minus below standard and plain hh:mm at or above it", () => {
    expect(formatSignedHM(-90)).toBe("-01:30");
    expect(formatSignedHM(495)).toBe("08:15");
    expect(formatSignedHM(0)).toBe("00:00");
    expect(formatSignedHM(-5)).toBe("-00:05");
    expect(formatSignedHM(6000)).toBe("100:00");
  });
});

describe("standard minutes", () => {
  const day = { start_time: "09:00:00", end_time: "17:30:00" };
  const base = { shift: day, dayOff: false, weekOff: false, holiday: false, leave: null, date: "2026-10-05", todayKey: "2026-10-23", punches: 0 };
  it("is the shift length, across midnight when the shift ends before it starts", () => {
    expect(shiftMinutes(day)).toBe(510);
    expect(shiftMinutes({ start_time: "21:00", end_time: "06:00" })).toBe(540);
    expect(shiftMinutes({ start_time: "09:00" })).toBe(0);
  });
  it("counts a scheduled past day and nothing for days off, holidays, leave, no shift or the future", () => {
    expect(standardMinutesForDay(base)).toBe(510);
    expect(standardMinutesForDay({ ...base, weekOff: true })).toBe(0);
    expect(standardMinutesForDay({ ...base, dayOff: true })).toBe(0);
    expect(standardMinutesForDay({ ...base, holiday: true })).toBe(0);
    expect(standardMinutesForDay({ ...base, leave: { half_day: false } })).toBe(0);
    expect(standardMinutesForDay({ ...base, shift: null })).toBe(0);
    expect(standardMinutesForDay({ ...base, date: "2026-10-30" })).toBe(0);
  });
  it("counts half a shift on a half-day leave, and today only once the person has punched", () => {
    expect(standardMinutesForDay({ ...base, leave: { half_day: true } })).toBe(255);
    expect(standardMinutesForDay({ ...base, date: "2026-10-23" })).toBe(0);
    expect(standardMinutesForDay({ ...base, date: "2026-10-23", punches: 1 })).toBe(510);
  });
});

describe("employment type error", () => {
  it("names the allowed types and where to add one", () => {
    const msg = employmentTypeError("Trainee", [{ code: "full_time", label: "Full-time" }, { code: "intern", label: "Intern" }, { code: "x", label: "x" }]);
    expect(msg).toBe("Employment type 'Trainee' is not set up. Add it in Settings > Workforce or use one of: Full-time (full_time), Intern (intern), x.");
  });
});

describe("sheet names", () => {
  it("replaces illegal characters and caps at 31", () => {
    expect(cleanSheetName("A/B:C?D*[E]\\F")).toBe("A-B-C-D--E--F");
    expect(cleanSheetName("x".repeat(40))).toHaveLength(31);
  });
  it("makes names unique, case-insensitively, inside 31 characters", () => {
    const taken = new Set<string>();
    const long = "L".repeat(31);
    expect(uniqueSheetName("Doha - Employee", taken)).toBe("Doha - Employee");
    expect(uniqueSheetName("doha - employee", taken)).toBe("doha - employee (2)");
    expect(uniqueSheetName(long, taken)).toBe(long);
    const second = uniqueSheetName(long, taken);
    expect(second).toHaveLength(31);
    expect(second.endsWith(" (2)")).toBe(true);
    expect(uniqueSheetName("", taken)).toBe("Sheet");
  });
});

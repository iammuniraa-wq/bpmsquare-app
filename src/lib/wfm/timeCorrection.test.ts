import { describe, it, expect } from "vitest";
import { editWindowStart, isWithinEditWindow, checkReason, SUPERVISOR_EDIT_MONTHS } from "./timeCorrection";

// The window is the only guard between a supervisor and a closed payroll
// month, and month arithmetic is where it would quietly go wrong.
describe("edit window", () => {
  it("is this month and last month by default", () => {
    expect(SUPERVISOR_EDIT_MONTHS).toBe(2);
    expect(editWindowStart("2026-10-11")).toBe("2026-09-01");
  });

  it("reaches back into the previous YEAR from January", () => {
    expect(editWindowStart("2026-01-15")).toBe("2025-12-01");
    expect(editWindowStart("2026-02-01")).toBe("2026-01-01");
  });

  it("can be tightened to the current month only", () => {
    expect(editWindowStart("2026-10-11", 1)).toBe("2026-10-01");
    expect(isWithinEditWindow("2026-09-30", "2026-10-11", 1)).toBe(false);
  });

  it("accepts the first day of last month and refuses the day before", () => {
    expect(isWithinEditWindow("2026-09-01", "2026-10-11")).toBe(true);
    expect(isWithinEditWindow("2026-08-31", "2026-10-11")).toBe(false);
  });

  it("refuses a future day", () => {
    expect(isWithinEditWindow("2026-10-12", "2026-10-11")).toBe(false);
    expect(isWithinEditWindow("2026-10-11", "2026-10-11")).toBe(true);
  });

  it("is not thrown by a timestamp-shaped today", () => {
    expect(editWindowStart("2026-10-11T08:00:00Z")).toBe("2026-09-01");
  });
});

describe("reason", () => {
  it("is required, and trimmed", () => {
    expect(checkReason("   forgot to punch out  ")).toEqual({ ok: true, value: "forgot to punch out" });
  });

  it("refuses empty, whitespace and token answers", () => {
    for (const bad of [undefined, null, "", "   ", ".", "ok", 12345]) {
      expect(checkReason(bad).ok, String(bad)).toBe(false);
    }
  });

  it("refuses an essay", () => {
    expect(checkReason("x".repeat(501)).ok).toBe(false);
    expect(checkReason("x".repeat(500)).ok).toBe(true);
  });
});

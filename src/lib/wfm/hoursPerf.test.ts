import { describe, it, expect } from "vitest";
import { shiftDayKey } from "./hours";

// Guards the 2026-09-23 BIM outage. shiftDayKey() calls two timezone
// formatters, and the monthly summary calls it once per event per employee
// -- ~139,000 times for 84 employees over 30 days. While each call built a
// fresh Intl.DateTimeFormat (~100us and several KB of ICU objects apiece),
// that one function exhausted a 2048MB Vercel Fluid instance and every
// request sharing it, including punch. Every database query in the same
// request finished in under 400ms; the cost was entirely here.
//
// The threshold is deliberately loose. Memoised, 100k calls run in well
// under a second; unmemoised they took tens of seconds on the same machine.
// Anything in between still fails, and no healthy machine trips it by noise.
describe("shiftDayKey cost", () => {
  it("stays cheap over a monthly-summary-sized workload", () => {
    const shift = { start_time: "09:00:00", crosses_midnight: false };
    const base = Date.UTC(2026, 8, 1, 3, 30);
    const started = Date.now();
    for (let i = 0; i < 100_000; i++) {
      shiftDayKey(new Date(base + i * 60_000), "Asia/Qatar", shift);
    }
    const elapsed = Date.now() - started;
    expect(elapsed, `100k shiftDayKey calls took ${elapsed}ms -- formatters are being rebuilt per call`).toBeLessThan(5000);
  });

  it("still applies the crosses_midnight rule", () => {
    const night = { start_time: "20:00:00", crosses_midnight: true };
    // 02:00 Qatar on the 2nd belongs to the shift-day that began on the 1st.
    expect(shiftDayKey(new Date("2026-09-01T23:00:00Z"), "Asia/Qatar", night)).toBe("2026-09-01");
    expect(shiftDayKey(new Date("2026-09-01T18:00:00Z"), "Asia/Qatar", night)).toBe("2026-09-01");
  });
});

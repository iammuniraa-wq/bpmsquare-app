import { describe, it, expect } from "vitest";
import { breakSegments, computeDayHours, shiftDayKey } from "./hours";

const TZ = "Asia/Kolkata"; // UTC+5:30, no DST -- deterministic for tests
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Build a UTC Date from an IST wall-clock time (Asia/Kolkata, no DST).
function ist(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h, min) - IST_OFFSET_MS);
}

describe("computeDayHours", () => {
  const T = (m: number) => ist(2026, 8, 5, 9, m).toISOString();
  const end = ist(2026, 8, 5, 9, 20);

  it("basic check-in/break/check-out", () => {
    const r = computeDayHours(
      [
        { kind: "check_in", ts: T(0) },
        { kind: "break_start", ts: T(10) },
        { kind: "break_end", ts: T(15) },
        { kind: "check_out", ts: T(20) },
      ],
      end
    );
    expect(r).toEqual({ gross_minutes: 20, break_minutes: 5, net_minutes: 15, open: false });
  });

  it("an open break at check-out is closed at the check-out instant", () => {
    const r = computeDayHours(
      [{ kind: "check_in", ts: T(0) }, { kind: "break_start", ts: T(10) }, { kind: "check_out", ts: T(20) }],
      end
    );
    expect(r).toEqual({ gross_minutes: 20, break_minutes: 10, net_minutes: 10, open: false });
  });

  it("still on break right now (open day, live running total)", () => {
    const r = computeDayHours([{ kind: "check_in", ts: T(0) }, { kind: "break_start", ts: T(10) }], end);
    expect(r).toEqual({ gross_minutes: 20, break_minutes: 10, net_minutes: 10, open: true });
  });

  it("two breaks in one day are both excluded", () => {
    const r = computeDayHours(
      [
        { kind: "check_in", ts: T(0) },
        { kind: "break_start", ts: T(5) }, { kind: "break_end", ts: T(10) },
        { kind: "break_start", ts: T(12) }, { kind: "break_end", ts: T(15) },
        { kind: "check_out", ts: T(20) },
      ],
      end
    );
    expect(r).toEqual({ gross_minutes: 20, break_minutes: 8, net_minutes: 12, open: false });
  });

  it("no check-in at all yields all zeros, not a crash", () => {
    expect(computeDayHours([{ kind: "break_start", ts: T(5) }], end))
      .toEqual({ gross_minutes: 0, break_minutes: 0, net_minutes: 0, open: false });
  });

  it("incomplete day (no check-out) still reports open=true with a live total", () => {
    const r = computeDayHours([{ kind: "check_in", ts: T(0) }], end);
    expect(r.open).toBe(true);
    expect(r.gross_minutes).toBe(20);
  });
});

describe("breakSegments", () => {
  const T = (m: number) => ist(2026, 8, 5, 9, m).toISOString();
  const end = ist(2026, 8, 5, 9, 40);

  it("returns every booked break in order", () => {
    const events = [
      { kind: "check_in" as const, ts: T(0) },
      { kind: "break_start" as const, ts: T(10) },
      { kind: "break_end" as const, ts: T(15) },
      { kind: "break_start" as const, ts: T(25) },
      { kind: "break_end" as const, ts: T(32) },
      { kind: "check_out" as const, ts: T(40) },
    ];
    const segs = breakSegments(events, end);
    expect(segs.map((s) => s.minutes)).toEqual([5, 7]);
    expect(segs[0]).toEqual({ start: T(10), end: T(15), minutes: 5 });
    // Always consistent with the single figure computeDayHours reports.
    expect(segs.reduce((s, x) => s + x.minutes, 0)).toBe(computeDayHours(events, end).break_minutes);
  });

  it("a break still open at check-out is closed at the check-out instant", () => {
    const segs = breakSegments(
      [
        { kind: "check_in", ts: T(0) },
        { kind: "break_start", ts: T(30) },
        { kind: "check_out", ts: T(40) },
      ],
      end
    );
    expect(segs).toEqual([{ start: T(30), end: T(40), minutes: 10 }]);
  });

  it("a still-running break has a null end and counts up to the end reference", () => {
    const segs = breakSegments(
      [
        { kind: "check_in", ts: T(0) },
        { kind: "break_start", ts: T(30) },
      ],
      end
    );
    expect(segs).toEqual([{ start: T(30), end: null, minutes: 10 }]);
  });

  it("no check-in means no breaks to report", () => {
    expect(breakSegments([{ kind: "break_start", ts: T(10) }], end)).toEqual([]);
  });
});

describe("shiftDayKey — midnight-crossing shift attribution (spec §6)", () => {
  const nightShift = { start_time: "22:00:00", crosses_midnight: true };
  const dayShift = { start_time: "09:00:00", crosses_midnight: false };

  it("a non-crossing shift (or no shift) uses the plain calendar day", () => {
    const noon = ist(2026, 8, 5, 12, 0);
    expect(shiftDayKey(noon, TZ, dayShift)).toBe("2026-08-05");
    expect(shiftDayKey(noon, TZ, null)).toBe("2026-08-05");
    expect(shiftDayKey(noon, TZ, undefined)).toBe("2026-08-05");
  });

  it("a night-shift check-in at 22:30 attributes to that same calendar day", () => {
    const checkIn = ist(2026, 8, 5, 22, 30);
    expect(shiftDayKey(checkIn, TZ, nightShift)).toBe("2026-08-05");
  });

  it("a night-shift check-out at 02:00 the NEXT calendar day still attributes to the shift's start date", () => {
    const checkOut = ist(2026, 8, 6, 2, 0);
    expect(shiftDayKey(checkOut, TZ, nightShift)).toBe("2026-08-05");
  });

  it("an event exactly at the shift's start time stays on that calendar day (not shifted back)", () => {
    const atStart = ist(2026, 8, 5, 22, 0);
    expect(shiftDayKey(atStart, TZ, nightShift)).toBe("2026-08-05");
  });

  it("a night-shift check-in and its next-day check-out land on the SAME shift-day", () => {
    const checkIn = ist(2026, 8, 5, 22, 30);
    const checkOut = ist(2026, 8, 6, 6, 0);
    const day = shiftDayKey(checkIn, TZ, nightShift);
    expect(shiftDayKey(checkOut, TZ, nightShift)).toBe(day);
  });
});

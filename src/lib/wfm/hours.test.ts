import { describe, it, expect } from "vitest";
import { breakSegments, computeDayHours, shiftDayKey, workSessions, punchStateAt } from "./hours";

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

  it("a second check-in later the same day does NOT bill the gap between sessions", () => {
    // 09:00–09:05 worked, away 09:05–09:15, 09:15–09:20 worked = 10 min.
    // The naive "last check_out − first check_in" span would say 20.
    const r = computeDayHours(
      [
        { kind: "check_in", ts: T(0) },
        { kind: "check_out", ts: T(5) },
        { kind: "check_in", ts: T(15) },
        { kind: "check_out", ts: T(20) },
      ],
      end
    );
    expect(r).toEqual({ gross_minutes: 10, break_minutes: 0, net_minutes: 10, open: false });
  });

  it("breaks inside a multi-session day are deducted from their own session", () => {
    const r = computeDayHours(
      [
        { kind: "check_in", ts: T(0) },
        { kind: "break_start", ts: T(2) }, { kind: "break_end", ts: T(4) },
        { kind: "check_out", ts: T(5) },
        { kind: "check_in", ts: T(15) },
        { kind: "check_out", ts: T(20) },
      ],
      end
    );
    expect(r).toEqual({ gross_minutes: 10, break_minutes: 2, net_minutes: 8, open: false });
  });

  it("a reopened session still running counts up to the end reference", () => {
    const r = computeDayHours(
      [
        { kind: "check_in", ts: T(0) },
        { kind: "check_out", ts: T(5) },
        { kind: "check_in", ts: T(15) },
      ],
      end
    );
    expect(r).toEqual({ gross_minutes: 10, break_minutes: 0, net_minutes: 10, open: true });
  });
});

describe("workSessions", () => {
  const T = (m: number) => ist(2026, 8, 5, 9, m).toISOString();
  const end = ist(2026, 8, 5, 9, 20);

  it("splits a day into each in→out pair", () => {
    const sessions = workSessions(
      [
        { kind: "check_in", ts: T(0) },
        { kind: "check_out", ts: T(5) },
        { kind: "check_in", ts: T(15) },
        { kind: "check_out", ts: T(20) },
      ],
      end
    );
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ in: T(0), out: T(5), gross_minutes: 5, net_minutes: 5 });
    expect(sessions[1]).toMatchObject({ in: T(15), out: T(20), gross_minutes: 5, net_minutes: 5 });
  });

  it("an unclosed final session has a null out", () => {
    const sessions = workSessions([{ kind: "check_in", ts: T(10) }], end);
    expect(sessions).toEqual([
      { in: T(10), out: null, gross_minutes: 10, break_minutes: 0, net_minutes: 10, breaks: [] },
    ]);
  });

  it("attributes each break to the session it happened in", () => {
    const sessions = workSessions(
      [
        { kind: "check_in", ts: T(0) },
        { kind: "break_start", ts: T(1) }, { kind: "break_end", ts: T(3) },
        { kind: "check_out", ts: T(5) },
        { kind: "check_in", ts: T(15) },
        { kind: "break_start", ts: T(16) }, { kind: "break_end", ts: T(17) },
        { kind: "check_out", ts: T(20) },
      ],
      end
    );
    expect(sessions[0].breaks).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ break_minutes: 2, net_minutes: 3 });
    expect(sessions[1].breaks).toHaveLength(1);
    expect(sessions[1]).toMatchObject({ break_minutes: 1, net_minutes: 4 });
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

describe("punchStateAt — shift-day rollover on a forgotten check-out", () => {
  // The BIM 2026-08-20 report: checked in yesterday, never checked out.
  // Carrying "in" into today rejected the morning check-in while letting
  // break punches through -- a live-board row saying "In" with no first-in.
  const dayShift = { start_time: "09:00:00", crosses_midnight: false };
  const nightShift = { start_time: "21:00:00", crosses_midnight: true };

  it("resets plain shift work to out on a new shift-day", () => {
    const lastIn = { kind: "check_in" as const, ts: ist(2026, 8, 19, 9, 5).toISOString() };
    expect(punchStateAt(lastIn, ist(2026, 8, 20, 9, 0), TZ, dayShift)).toBe("out");
    const lastBreakEnd = { kind: "break_end" as const, ts: ist(2026, 8, 19, 15, 0).toISOString() };
    expect(punchStateAt(lastBreakEnd, ist(2026, 8, 20, 9, 0), TZ, dayShift)).toBe("out");
    const lastBreakStart = { kind: "break_start" as const, ts: ist(2026, 8, 19, 15, 0).toISOString() };
    expect(punchStateAt(lastBreakStart, ist(2026, 8, 20, 9, 0), TZ, dayShift)).toBe("out");
  });

  it("carries state within the same shift-day", () => {
    const lastIn = { kind: "check_in" as const, ts: ist(2026, 8, 20, 9, 5).toISOString() };
    expect(punchStateAt(lastIn, ist(2026, 8, 20, 13, 0), TZ, dayShift)).toBe("in");
    const lastBreak = { kind: "break_start" as const, ts: ist(2026, 8, 20, 13, 0).toISOString() };
    expect(punchStateAt(lastBreak, ist(2026, 8, 20, 13, 30), TZ, dayShift)).toBe("break");
  });

  it("a night shift's 05:40 punch still belongs to yesterday's shift-day", () => {
    const lastIn = { kind: "check_in" as const, ts: ist(2026, 8, 19, 21, 10).toISOString() };
    // 05:40 next calendar day, before the 21:00 start -> same shift-day, still in
    expect(punchStateAt(lastIn, ist(2026, 8, 20, 5, 40), TZ, nightShift)).toBe("in");
    // 21:05 the next evening -> a NEW shift-day, forgotten check-out resets
    expect(punchStateAt(lastIn, ist(2026, 8, 20, 21, 5), TZ, nightShift)).toBe("out");
  });

  it("multi-day sessions keep carrying across shift-days", () => {
    const trip = { kind: "business_trip_start" as const, ts: ist(2026, 8, 18, 8, 0).toISOString() };
    expect(punchStateAt(trip, ist(2026, 8, 20, 18, 0), TZ, dayShift)).toBe("in");
    const ot = { kind: "ot_in" as const, ts: ist(2026, 8, 19, 22, 0).toISOString() };
    expect(punchStateAt(ot, ist(2026, 8, 20, 1, 30), TZ, dayShift)).toBe("ot");
    const mobile = { kind: "mobile_work_start" as const, ts: ist(2026, 8, 19, 10, 0).toISOString() };
    expect(punchStateAt(mobile, ist(2026, 8, 20, 10, 0), TZ, dayShift)).toBe("in");
  });

  it("no last event, or a closing kind, is simply out", () => {
    expect(punchStateAt(null, ist(2026, 8, 20, 9, 0), TZ, dayShift)).toBe("out");
    const lastOut = { kind: "check_out" as const, ts: ist(2026, 8, 20, 18, 0).toISOString() };
    expect(punchStateAt(lastOut, ist(2026, 8, 20, 18, 5), TZ, dayShift)).toBe("out");
  });

  it("no shift configured falls back to calendar-day rollover", () => {
    const lastIn = { kind: "check_in" as const, ts: ist(2026, 8, 19, 9, 0).toISOString() };
    expect(punchStateAt(lastIn, ist(2026, 8, 19, 23, 0), TZ, null)).toBe("in");
    expect(punchStateAt(lastIn, ist(2026, 8, 20, 0, 30), TZ, null)).toBe("out");
  });
});

import { describe, it, expect } from "vitest";
import { computeDayHours, overnightTail, shiftDayKey, workSessions } from "./hours";
import type { PresenceKind } from "./types";

const TZ = "Asia/Kolkata";
const ev = (kind: PresenceKind, ts: string) => ({ kind, ts });

// The client's 2nd shift: 14:00–23:00, NOT flagged crosses_midnight. Someone
// who stays past midnight is exactly the case that used to pay zero.
const dayShift = { start_time: "14:00:00", crosses_midnight: false };
const nightShift = { start_time: "21:00:00", crosses_midnight: true };

/** What getMonthlySummary does: bucket by shift-day, then pull back the
 * closing punch when the session ran over. */
function dayTotal(all: { kind: PresenceKind; ts: string }[], date: string, shift: typeof dayShift) {
  const dayEvents = all.filter((e) => shiftDayKey(new Date(e.ts), TZ, shift) === date);
  const tail = overnightTail(dayEvents, all);
  const evs = tail.length > 0 ? [...dayEvents, ...tail] : dayEvents;
  const endRef = evs.length > 0 ? new Date(evs[evs.length - 1].ts) : new Date(`${date}T00:00:00Z`);
  return computeDayHours(evs, endRef);
}

/** The "Check Out" column's source. Mirrors getMonthlySummary: the overnight
 * tail is included so a shift closing past midnight reports its real closing
 * punch, but the answer comes from the SESSIONS, so a closing punch belonging
 * to a session that started on an earlier day is not claimed by this one. */
function lastOutOf(all: { kind: PresenceKind; ts: string }[], date: string, shift: typeof dayShift) {
  const dayEvents = all.filter((e) => shiftDayKey(new Date(e.ts), TZ, shift) === date);
  const tail = overnightTail(dayEvents, all);
  const evs = tail.length > 0 ? [...dayEvents, ...tail] : dayEvents;
  const endRef = evs.length > 0 ? new Date(evs[evs.length - 1].ts) : new Date(`${date}T00:00:00Z`);
  return [...workSessions(evs, endRef)].reverse().find((s) => s.out !== null)?.out ?? null;
}

/** The "Check In" column's source, unchanged: the day's first check_in. */
function firstInOf(all: { kind: PresenceKind; ts: string }[], date: string, shift: typeof dayShift) {
  return all
    .filter((e) => shiftDayKey(new Date(e.ts), TZ, shift) === date)
    .find((e) => e.kind === "check_in")?.ts ?? null;
}

describe("work past midnight on a shift that isn't flagged crosses_midnight", () => {
  // 22:00 IST 11 Aug -> 02:00 IST 12 Aug = 4 hours.
  const all = [
    ev("check_in", "2026-08-11T16:30:00.000Z"),
    ev("check_out", "2026-08-11T20:30:00.000Z"),
  ];

  it("pays the full 4 hours on the day the shift started", () => {
    const d1 = dayTotal(all, "2026-08-11", dayShift);
    expect(d1.gross_minutes).toBe(240);
    expect(d1.open).toBe(false); // no longer an incomplete day
  });

  it("does not also pay them on the following day", () => {
    const d2 = dayTotal(all, "2026-08-12", dayShift);
    expect(d2.gross_minutes).toBe(0);
  });

  it("still works when the shift IS flagged crosses_midnight", () => {
    const d1 = dayTotal(all, "2026-08-11", nightShift);
    expect(d1.gross_minutes).toBe(240);
  });

  it("reports the past-midnight closing punch as last_out, not the earlier same-day one", () => {
    // 15:30 IST in, 20:24 IST out, 23:57 IST in, then 02:00 IST (next day) out.
    const shifted = [
      ev("check_in", "2026-08-11T10:00:00.000Z"),  // 15:30 IST 11 Aug
      ev("check_out", "2026-08-11T14:54:00.000Z"), // 20:24 IST 11 Aug (earlier same-day out)
      ev("check_in", "2026-08-11T18:27:00.000Z"),  // 23:57 IST 11 Aug
      ev("check_out", "2026-08-11T20:30:00.000Z"), // 02:00 IST 12 Aug (real last out)
    ];
    // The overnight closing punch, not the 20:24 IST one from before the gap.
    expect(lastOutOf(shifted, "2026-08-11", dayShift)).toBe("2026-08-11T20:30:00.000Z");
  });
});

describe("overnightTail stays narrow", () => {
  it("ignores a check-out forgotten for days — that must stay incomplete", () => {
    const all = [
      ev("check_in", "2026-08-11T16:30:00.000Z"),
      ev("check_out", "2026-08-14T09:00:00.000Z"), // ~64h later
    ];
    const dayEvents = [all[0]];
    expect(overnightTail(dayEvents, all)).toEqual([]);
    expect(dayTotal(all, "2026-08-11", dayShift).open).toBe(true);
  });

  it("does not borrow a punch that starts a session", () => {
    const all = [
      ev("check_in", "2026-08-11T16:30:00.000Z"),
      ev("check_in", "2026-08-12T03:30:00.000Z"),
    ];
    expect(overnightTail([all[0]], all)).toEqual([]);
  });

  it("leaves a properly closed day alone", () => {
    const all = [
      ev("check_in", "2026-08-11T03:30:00.000Z"),
      ev("check_out", "2026-08-11T12:30:00.000Z"),
    ];
    expect(overnightTail(all, all)).toEqual([]);
  });

  it("counts breaks taken before midnight", () => {
    const all = [
      ev("check_in", "2026-08-11T16:30:00.000Z"),   // 22:00
      ev("break_start", "2026-08-11T18:00:00.000Z"), // 23:30
      ev("break_end", "2026-08-11T18:30:00.000Z"),   // 00:00
      ev("check_out", "2026-08-11T20:30:00.000Z"),   // 02:00
    ];
    const d = dayTotal(all, "2026-08-11", dayShift);
    expect(d.gross_minutes).toBe(240);
    expect(d.break_minutes).toBe(30);
    expect(d.net_minutes).toBe(210);
  });
});

// Reported 2026-09-04: the live board showed "In 11:31 am / Out 09:30 am" --
// a check-out four hours BEFORE the check-in, on a row still marked In.
//
// The cause was never a bad punch. A session opened the previous day and
// closed the next morning; the closing punch's own timestamp puts it in the
// NEW day's bucket, and both the live board and the monthly summary reported
// the latest check_out in that bucket as the day's "last out". So the orphan
// close from yesterday's session was presented as today's.
describe("a check-out that closes the PREVIOUS day's session", () => {
  // General shift, 09:00, not flagged crosses_midnight -- so a punch keeps
  // its own calendar day.
  const generalShift = { start_time: "09:00:00", crosses_midnight: false };

  // In 10:00 IST on the 2nd; forgotten. Out 09:30 IST on the 3rd (25.5h
  // later, so beyond overnightTail's 18h reach). Back in 11:31 the same
  // morning for a real day's work.
  const all = [
    ev("check_in", "2026-09-02T04:30:00.000Z"),  // 10:00 on the 2nd
    ev("check_out", "2026-09-03T04:00:00.000Z"), // 09:30 on the 3rd
    ev("check_in", "2026-09-03T06:01:00.000Z"),  // 11:31 on the 3rd
  ];

  it("does not report yesterday's closing punch as today's last out", () => {
    expect(lastOutOf(all, "2026-09-03", generalShift)).toBeNull();
  });

  it("still reports today's real first check-in", () => {
    expect(firstInOf(all, "2026-09-03", generalShift)).toBe("2026-09-03T06:01:00.000Z");
  });

  it("never reports an out that precedes the in", () => {
    const first = firstInOf(all, "2026-09-03", generalShift);
    const last = lastOutOf(all, "2026-09-03", generalShift);
    if (first && last) expect(new Date(last).getTime()).toBeGreaterThan(new Date(first).getTime());
  });

  it("does not pay the orphan close as hours on the new day", () => {
    // The open session from 11:31 runs to endRef; what matters is that the
    // 09:30 close contributes nothing, so the day is not credited backwards.
    expect(dayTotal(all, "2026-09-03", generalShift).gross_minutes).toBe(0);
  });

  it("reports a genuine same-day close normally", () => {
    const clean = [
      ev("check_in", "2026-09-03T03:30:00.000Z"),  // 09:00
      ev("check_out", "2026-09-03T12:30:00.000Z"), // 18:00
    ];
    expect(lastOutOf(clean, "2026-09-03", generalShift)).toBe("2026-09-03T12:30:00.000Z");
  });

  it("reports the earlier close when a later session is still open", () => {
    const twoSessions = [
      ev("check_in", "2026-09-03T03:30:00.000Z"),  // 09:00
      ev("check_out", "2026-09-03T06:30:00.000Z"), // 12:00
      ev("check_in", "2026-09-03T07:30:00.000Z"),  // 13:00, still open
    ];
    expect(lastOutOf(twoSessions, "2026-09-03", generalShift)).toBe("2026-09-03T06:30:00.000Z");
  });
});

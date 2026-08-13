import { describe, it, expect } from "vitest";
import { computeDayHours, overnightTail, shiftDayKey } from "./hours";
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

/** The "Check Out" column's source: getMonthlySummary derives last_out from
 * the events INCLUDING the overnight tail, so it reports the real closing
 * punch even when it lands past midnight. */
function lastOutOf(all: { kind: PresenceKind; ts: string }[], date: string, shift: typeof dayShift) {
  const dayEvents = all.filter((e) => shiftDayKey(new Date(e.ts), TZ, shift) === date);
  const tail = overnightTail(dayEvents, all);
  const evs = tail.length > 0 ? [...dayEvents, ...tail] : dayEvents;
  return [...evs].reverse().find((e) => e.kind === "check_out")?.ts ?? null;
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

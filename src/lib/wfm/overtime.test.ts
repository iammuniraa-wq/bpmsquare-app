import { describe, it, expect } from "vitest";
import { applyPunch, deriveState, allowedKinds, stateFromLastKind } from "./types";
import { otSessions, otMinutes, computeDayHours, workSessions, shiftDayKey } from "./hours";

const TZ = "Asia/Kolkata";
/** An IST wall-clock time as a real UTC Date (IST = UTC+5:30). */
const ist = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h - 5, mi - 30));
const at = (h: number, mi = 0, day = 12) => ist(2026, 8, day, h, mi).toISOString();

describe("OT state machine", () => {
  it("OT is reachable from `out` and returns to `out`", () => {
    expect(applyPunch("out", "ot_in")).toBe("ot");
    expect(applyPunch("ot", "ot_out")).toBe("out");
  });

  // The client's rule: "OT can happen anytime but not in between check-in
  // and check-out." Enforced structurally -- there is no ot_in transition
  // out of `in` or `break`, so it can't be nested inside a shift.
  it("OT cannot start while checked in or on break", () => {
    expect(applyPunch("in", "ot_in")).toBeNull();
    expect(applyPunch("break", "ot_in")).toBeNull();
  });

  it("nothing but ot_out is legal while on OT", () => {
    expect(allowedKinds("ot")).toEqual(["ot_out"]);
    expect(applyPunch("ot", "check_in")).toBeNull();
    expect(applyPunch("ot", "break_start")).toBeNull();
    expect(applyPunch("ot", "check_out")).toBeNull();
  });

  it("the client's actual flow works: shift → check out → OT → out", () => {
    expect(deriveState([
      { kind: "check_in" }, { kind: "check_out" },
      { kind: "ot_in" }, { kind: "ot_out" },
    ])).toBe("out");
  });

  it("mobile work and business trip are ordinary work sessions", () => {
    expect(applyPunch("out", "mobile_work_start")).toBe("in");
    expect(applyPunch("in", "mobile_work_end")).toBe("out");
    expect(applyPunch("out", "business_trip_start")).toBe("in");
    expect(applyPunch("break", "business_trip_end")).toBe("out");
  });

  it("stateFromLastKind maps every kind to the right resting state", () => {
    expect(stateFromLastKind(null)).toBe("out");
    expect(stateFromLastKind("check_in")).toBe("in");
    expect(stateFromLastKind("mobile_work_start")).toBe("in");
    expect(stateFromLastKind("break_start")).toBe("break");
    expect(stateFromLastKind("break_end")).toBe("in");
    expect(stateFromLastKind("ot_in")).toBe("ot");
    expect(stateFromLastKind("ot_out")).toBe("out");
    expect(stateFromLastKind("check_out")).toBe("out");
  });
});

describe("OT session pairing", () => {
  it("pairs ot_in→ot_out and reports exact minutes (no rounding)", () => {
    const events = [
      { kind: "ot_in" as const, ts: at(23, 0) },
      { kind: "ot_out" as const, ts: at(1, 37, 13) }, // 2h37m later
    ];
    const stretches = otSessions(events, ist(2026, 8, 13, 2, 0));
    expect(stretches).toHaveLength(1);
    expect(stretches[0].minutes).toBe(157);
    expect(otMinutes(events, ist(2026, 8, 13, 2, 0))).toBe(157);
  });

  it("an open OT stretch runs to endRef but is NOT payable yet", () => {
    const events = [{ kind: "ot_in" as const, ts: at(22, 0) }];
    const stretches = otSessions(events, ist(2026, 8, 12, 23, 30));
    expect(stretches[0].end).toBeNull();
    expect(stretches[0].minutes).toBe(90);
    // otMinutes only counts CLOSED stretches -- an in-progress punch isn't pay.
    expect(otMinutes(events, ist(2026, 8, 12, 23, 30))).toBe(0);
  });

  it("counts several OT stretches in one day", () => {
    const events = [
      { kind: "ot_in" as const, ts: at(6, 0) }, { kind: "ot_out" as const, ts: at(8, 0) },
      { kind: "ot_in" as const, ts: at(19, 0) }, { kind: "ot_out" as const, ts: at(21, 30) },
    ];
    expect(otMinutes(events, ist(2026, 8, 12, 22, 0))).toBe(120 + 150);
  });
});

describe("OT is kept out of regular working hours", () => {
  it("a shift plus OT after it counts only the shift as worked time", () => {
    const events = [
      { kind: "check_in" as const, ts: at(14, 0) },
      { kind: "check_out" as const, ts: at(23, 0) },   // 9h regular
      { kind: "ot_in" as const, ts: at(23, 10) },
      { kind: "ot_out" as const, ts: at(3, 0, 13) },   // OT past midnight
    ];
    const endRef = ist(2026, 8, 13, 3, 0);
    const hours = computeDayHours(events, endRef);
    expect(hours.gross_minutes).toBe(9 * 60);
    expect(hours.open).toBe(false); // the trailing ot_in must not look like an open shift
    expect(workSessions(events, endRef)).toHaveLength(1);
    // ...and the OT itself is a separate 3h50m block.
    expect(otMinutes(events, endRef)).toBe(230);
  });

  it("mobile work counts as regular working time", () => {
    const events = [
      { kind: "mobile_work_start" as const, ts: at(9, 0) },
      { kind: "mobile_work_end" as const, ts: at(17, 30) },
    ];
    const hours = computeDayHours(events, ist(2026, 8, 12, 18, 0));
    expect(hours.gross_minutes).toBe(510);
  });
});

describe("OT spanning midnight (the client's 'entire night' case)", () => {
  // Shift 2 is 14:00-23:00 and does NOT cross midnight, so shiftDayKey puts
  // a 03:00 punch on the next calendar day. That's exactly why the OT
  // SESSION carries its own ot_date (the day it started) rather than being
  // re-derived per day -- otherwise an all-night block would be split.
  const shift2 = { start_time: "14:00:00", crosses_midnight: false };

  it("the raw punch-day attribution does split at midnight", () => {
    expect(shiftDayKey(ist(2026, 8, 12, 23, 10), TZ, shift2)).toBe("2026-08-12");
    expect(shiftDayKey(ist(2026, 8, 13, 3, 0), TZ, shift2)).toBe("2026-08-13");
  });

  it("pairing by session keeps the whole night as one block on the start day", () => {
    const events = [
      { kind: "ot_in" as const, ts: at(23, 10) },
      { kind: "ot_out" as const, ts: at(6, 0, 13) },
    ];
    const stretches = otSessions(events, ist(2026, 8, 13, 6, 0));
    expect(stretches).toHaveLength(1);
    expect(stretches[0].minutes).toBe(410); // 6h50m, unrounded
    // The day it belongs to is the START punch's day -- what the punch API
    // stamps onto wfm_ot_sessions.ot_date.
    expect(shiftDayKey(new Date(stretches[0].start), TZ, shift2)).toBe("2026-08-12");
  });
});

import { describe, it, expect } from "vitest";
import { makeShiftResolver, type ShiftLike, type RosterLike } from "./effectiveShift";

const DAY: ShiftLike = { id: "day", name: "General Shift", start_time: "09:00:00", grace_minutes: 15 };
const NIGHT: ShiftLike = { id: "night", name: "Night", start_time: "21:00:00", grace_minutes: 15, crosses_midnight: true };
const shiftById = new Map<string, ShiftLike>([["day", DAY], ["night", NIGHT]]);

const RAVI = "ravi";
const standing = new Map<string, string | null>([[RAVI, "day"], ["nobody", null]]);

const resolve = (roster: RosterLike[]) => makeShiftResolver(roster, shiftById, standing);

describe("effective shift for a date", () => {
  it("falls back to the standing shift when nothing is rostered", () => {
    const r = resolve([])(RAVI, "2026-08-12");
    expect(r.shift?.id).toBe("day");
    expect(r.fromRoster).toBe(false);
  });

  it("uses the ROSTERED shift over the standing one — the whole bug", () => {
    const r = resolve([
      { employee_id: RAVI, date: "2026-08-12", shift_id: "night", is_day_off: false },
    ])(RAVI, "2026-08-12");
    expect(r.shift?.id).toBe("night");
    expect(r.fromRoster).toBe(true);
  });

  it("only applies to the rostered date, not the ones either side", () => {
    const roster = [{ employee_id: RAVI, date: "2026-08-12", shift_id: "night", is_day_off: false }];
    expect(resolve(roster)(RAVI, "2026-08-11").shift?.id).toBe("day");
    expect(resolve(roster)(RAVI, "2026-08-12").shift?.id).toBe("night");
    expect(resolve(roster)(RAVI, "2026-08-13").shift?.id).toBe("day");
  });

  it("does not leak one employee's roster onto another", () => {
    const roster = [{ employee_id: "someone-else", date: "2026-08-12", shift_id: "night", is_day_off: false }];
    expect(resolve(roster)(RAVI, "2026-08-12").shift?.id).toBe("day");
  });

  it("reports a rostered day off, so no lateness or absence is measured", () => {
    const r = resolve([
      { employee_id: RAVI, date: "2026-08-12", shift_id: null, is_day_off: true },
    ])(RAVI, "2026-08-12");
    expect(r.isDayOff).toBe(true);
    expect(r.shift).toBeNull();
  });

  it("keeps the standing shift when a roster row names no shift", () => {
    const r = resolve([
      { employee_id: RAVI, date: "2026-08-12", shift_id: null, is_day_off: false },
    ])(RAVI, "2026-08-12");
    expect(r.shift?.id).toBe("day");
  });

  it("returns no shift for someone with neither a roster nor a standing shift", () => {
    const r = resolve([])("nobody", "2026-08-12");
    expect(r.shift).toBeNull();
    expect(r.isDayOff).toBe(false);
  });
});

describe("the false-late-mark scenario, end to end", () => {
  // Ravi's standing shift starts 09:00. He is rostered onto nights (21:00)
  // and checks in at 20:55 -- five minutes EARLY for the shift he is on.
  const roster = [{ employee_id: RAVI, date: "2026-08-12", shift_id: "night", is_day_off: false }];
  const checkInMinutes = 20 * 60 + 55;

  const isLate = (shift: ShiftLike | null) => {
    if (!shift) return false;
    const [h, m] = shift.start_time.slice(0, 5).split(":").map(Number);
    return checkInMinutes > h * 60 + m + shift.grace_minutes;
  };

  it("was marked late against the standing shift", () => {
    expect(isLate(DAY)).toBe(true); // the old behaviour, ~12 hours "late"
  });

  it("is on time against the rostered shift", () => {
    expect(isLate(resolve(roster)(RAVI, "2026-08-12").shift)).toBe(false);
  });
});

// Which shift an employee was actually on, for a given date.
//
// The roster (wfm_roster_assignments, 0072) has been written by supervisors
// since it shipped, and read by NOTHING except its own screen -- every rules
// path (monthly summary, live board, late-arrival email) resolved the shift
// from employees.shift_id alone. So an employee rostered onto nights for a
// week was still measured against their standing day shift: checking in at
// 21:00 for a 21:00 shift was marked LATE by twelve hours, every night, and
// the supervisor got an email about it each time.
//
// Pure and dependency-free so it can be unit-tested and shared by the summary,
// the live board and the punch route without any of them re-deriving it.

export type ShiftLike = {
  id: string;
  name: string;
  start_time: string;
  end_time?: string;
  grace_minutes: number;
  is_night_shift?: boolean;
  night_allowance_amount?: number;
  crosses_midnight?: boolean;
};

export type RosterLike = {
  employee_id: string;
  date: string;        // YYYY-MM-DD
  shift_id: string | null;
  is_day_off: boolean;
};

export type EffectiveShift = {
  shift: ShiftLike | null;
  /** Rostered explicitly off. No lateness, no absence -- the employee was
   * not expected in, so measuring them against any shift is wrong. */
  isDayOff: boolean;
  /** True when an explicit roster row decided this, rather than the standing
   * shift being used as the fallback. */
  fromRoster: boolean;
};

/**
 * Build a `(employeeId, date) -> EffectiveShift` lookup.
 *
 * Precedence, highest first:
 *   1. a roster row for that employee AND date  (a day off wins outright)
 *   2. the employee's standing shift            (employees.shift_id)
 *   3. nothing -- no shift, so no lateness or absence can be computed
 */
export function makeShiftResolver(
  rosterRows: RosterLike[],
  shiftById: Map<string, ShiftLike>,
  standingShiftIdByEmployee: Map<string, string | null>
): (employeeId: string, date: string) => EffectiveShift {
  const rosterByKey = new Map<string, RosterLike>();
  for (const r of rosterRows) rosterByKey.set(`${r.employee_id}|${r.date}`, r);

  return (employeeId: string, date: string): EffectiveShift => {
    const rostered = rosterByKey.get(`${employeeId}|${date}`);
    if (rostered) {
      if (rostered.is_day_off) return { shift: null, isDayOff: true, fromRoster: true };
      const shift = rostered.shift_id ? shiftById.get(rostered.shift_id) ?? null : null;
      // A roster row with no shift is still an explicit statement about the
      // day; fall back to the standing shift only when the row itself is
      // silent about which shift, not when it named one we can't resolve.
      if (shift) return { shift, isDayOff: false, fromRoster: true };
    }
    const standingId = standingShiftIdByEmployee.get(employeeId) ?? null;
    return {
      shift: standingId ? shiftById.get(standingId) ?? null : null,
      isDayOff: false,
      fromRoster: false,
    };
  };
}

import type { WorkSession } from "./hours";

// Rolling worked minutes up per project. Pure, so the attribution arithmetic
// is testable without a database -- same convention as hours.ts.
//
// Sessions are the unit, not days: a day can legitimately contain sessions on
// different projects (a mid-shift transfer), and summing a day into one
// bucket would be the whole point of §5 thrown away at the last step.

/** The bucket key for hours nobody attributed. A real, reportable state --
 *  utilisation needs a bench figure, and an unassigned day is something a
 *  supervisor must be able to see and fix. See WFM_PROJECT_COSTING.md §8. */
export const UNASSIGNED = "__unassigned__";

export type ProjectHoursRow = {
  /** Project id, or UNASSIGNED. */
  key: string;
  gross_minutes: number;
  break_minutes: number;
  net_minutes: number;
  /** How many work sessions landed here — not days: one day can contribute
   *  to two projects. */
  sessions: number;
};

export type SessionsForEmployee = {
  employee_id: string;
  sessions: WorkSession[];
};

/**
 * Total minutes per project across many employees' sessions.
 *
 * `deductBreaks` mirrors the tenant's own config, exactly as the monthly
 * summary does — a project's hours must equal the hours the same period's
 * timesheet shows for those people, or the two screens contradict each other
 * and neither gets trusted.
 */
export function rollUpProjectHours(
  input: SessionsForEmployee[],
  deductBreaks: boolean
): ProjectHoursRow[] {
  const acc = new Map<string, ProjectHoursRow>();

  for (const { sessions } of input) {
    for (const s of sessions) {
      const key = s.project_id ?? UNASSIGNED;
      const row = acc.get(key) ?? { key, gross_minutes: 0, break_minutes: 0, net_minutes: 0, sessions: 0 };
      row.gross_minutes += s.gross_minutes;
      row.break_minutes += s.break_minutes;
      row.net_minutes += deductBreaks ? s.net_minutes : s.gross_minutes;
      row.sessions += 1;
      acc.set(key, row);
    }
  }

  // Biggest first — the point of the screen is "where did the time go".
  // UNASSIGNED sorts with everything else rather than being pinned last: if
  // most hours are unattributed, that IS the headline and hiding it at the
  // bottom would be the wrong emphasis.
  return [...acc.values()].sort((a, b) => b.net_minutes - a.net_minutes);
}

/** Distinct employees who booked time to each project — headcount alongside
 *  hours, since 200 hours from one person and from ten mean different things. */
export function projectHeadcount(input: SessionsForEmployee[]): Map<string, number> {
  const people = new Map<string, Set<string>>();
  for (const { employee_id, sessions } of input) {
    for (const s of sessions) {
      const key = s.project_id ?? UNASSIGNED;
      const set = people.get(key) ?? new Set<string>();
      set.add(employee_id);
      people.set(key, set);
    }
  }
  return new Map([...people].map(([k, v]) => [k, v.size]));
}

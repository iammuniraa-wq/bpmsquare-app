// Client-safe half of the delete-impact check: the shape and the plain-words list.

export type EmployeeImpact = {
  punches: number;
  first_punch: string | null;
  last_punch: string | null;
  leave_records: number;
  leave_requests: number;
  corrections: number;
  overtime_sessions: number;
  recheck_requests: number;
  advance_requests: number;
  clarifications: number;
  roster_entries: number;
  /** Sum of every count above; anything over zero blocks delete. */
  total: number;
};

/** The plain-words list the dialog and the 409 message share, nonzero lines only. */
export function describeImpact(impact: EmployeeImpact): string[] {
  const n = (v: number, one: string, many: string) => (v > 0 ? `${v} ${v === 1 ? one : many}` : null);
  return [
    n(impact.punches, "recorded punch", "recorded punches"),
    n(impact.leave_records, "leave record", "leave records"),
    n(impact.leave_requests, "leave request", "leave requests"),
    n(impact.corrections, "time correction", "time corrections"),
    n(impact.overtime_sessions, "overtime session", "overtime sessions"),
    n(impact.recheck_requests, "re-check request", "re-check requests"),
    n(impact.advance_requests, "advance request", "advance requests"),
    n(impact.clarifications, "clarification thread", "clarification threads"),
    n(impact.roster_entries, "roster entry", "roster entries"),
  ].filter((x): x is string => x !== null);
}

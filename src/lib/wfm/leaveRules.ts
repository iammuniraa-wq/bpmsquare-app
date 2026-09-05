// Leave type rules (0109): monthly caps and paid-days-per-month. Pure, so
// the request route, the admin-entry route and the monthly summary all
// apply exactly the same arithmetic. A half-day counts 0.5, as everywhere
// else in WFM.

export type LeaveSpan = { date_from: string; date_to: string; half_day: boolean };

function nextDay(d: string): string {
  const n = new Date(d + "T00:00:00Z");
  n.setUTCDate(n.getUTCDate() + 1);
  return n.toISOString().slice(0, 10);
}

/** Days of leave per calendar month ("2026-09" -> 1.5) across a span. */
export function leaveDaysByMonth(span: LeaveSpan): Record<string, number> {
  const out: Record<string, number> = {};
  const weight = span.half_day ? 0.5 : 1;
  for (let d = span.date_from; d <= span.date_to; d = nextDay(d)) {
    const m = d.slice(0, 7);
    out[m] = (out[m] ?? 0) + weight;
  }
  return out;
}

export type MonthlyLimitViolation = { month: string; limit: number; already: number; requested: number };

/**
 * Would adding `requested` on top of `existing` (approved records + pending
 * requests of the same type, same employee) exceed the type's monthly limit
 * in any month? Returns the first offending month, or null.
 */
export function checkMonthlyLimit(
  limit: number | null | undefined,
  requested: LeaveSpan,
  existing: LeaveSpan[]
): MonthlyLimitViolation | null {
  if (limit === null || limit === undefined || !(limit > 0)) return null;
  const want = leaveDaysByMonth(requested);
  const have: Record<string, number> = {};
  for (const e of existing) {
    for (const [m, days] of Object.entries(leaveDaysByMonth(e))) have[m] = (have[m] ?? 0) + days;
  }
  for (const month of Object.keys(want).sort()) {
    const already = have[month] ?? 0;
    if (already + want[month] > limit + 1e-9) return { month, limit, already, requested: want[month] };
  }
  return null;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Paid-days-per-month: walk one employee's leave days of one type in one
 * month in date order and say, for each day, whether it still falls within
 * the paid allowance. The day's own weight (1 or 0.5) is what it consumes.
 */
export function paidWithinMonthlyAllowance(
  allowance: number | null | undefined,
  daysInOrder: { date: string; half_day: boolean }[]
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  if (allowance === null || allowance === undefined) {
    for (const d of daysInOrder) out.set(d.date, true);
    return out;
  }
  let used = 0;
  for (const d of [...daysInOrder].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const w = d.half_day ? 0.5 : 1;
    const paid = used + w <= allowance + 1e-9;
    out.set(d.date, paid);
    used += w;
  }
  return out;
}

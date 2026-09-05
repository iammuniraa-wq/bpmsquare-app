// Roster rows are stored one per employee per date -- that is what the
// attribution engine needs. People do not think in rows: "Abdul is on Tower B
// next week" is one fact, and the roster screen listed it as seven, each
// with its own Remove (owner-reported 2026-09-06). This folds rows back into
// the spans they were created as, so one line shows and one click undoes.
//
// Pure and dependency-free, like hours.ts and projectTree.ts, so the folding
// rule is unit-tested rather than trusted.

export type SpanRow = {
  id: string;
  employee_id: string;
  date: string; // YYYY-MM-DD
  is_day_off: boolean;
  shift_id?: string | null;
  project_id?: string | null;
};

export type Span<T extends SpanRow> = {
  /** The first row's key fields; every row in the span shares them. */
  employee_id: string;
  is_day_off: boolean;
  shift_id: string | null;
  project_id: string | null;
  from: string;
  to: string;
  /** Every roster row folded into this span, in date order. */
  rows: T[];
};

const DAY_MS = 86_400_000;

/** Whether `b` is the calendar day after `a`. */
function consecutive(a: string, b: string): boolean {
  return Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`) === DAY_MS;
}

/**
 * Fold rows into spans: same employee, same shift / project / day-off, on
 * consecutive dates. A gap of even one day starts a new span -- a Monday and
 * a Wednesday are two facts, not one with a hole -- and so does any change
 * in what the row says.
 */
export function groupSpans<T extends SpanRow>(rows: T[]): Span<T>[] {
  const sorted = [...rows].sort((a, b) =>
    a.employee_id.localeCompare(b.employee_id) || a.date.localeCompare(b.date)
  );
  const out: Span<T>[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const same =
      last &&
      last.employee_id === r.employee_id &&
      last.is_day_off === r.is_day_off &&
      last.shift_id === (r.shift_id ?? null) &&
      last.project_id === (r.project_id ?? null) &&
      consecutive(last.to, r.date);
    if (same) {
      last.to = r.date;
      last.rows.push(r);
    } else {
      out.push({
        employee_id: r.employee_id,
        is_day_off: r.is_day_off,
        shift_id: r.shift_id ?? null,
        project_id: r.project_id ?? null,
        from: r.date,
        to: r.date,
        rows: [r],
      });
    }
  }
  // Soonest first, so what is about to happen is at the top.
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.employee_id.localeCompare(b.employee_id));
}

/**
 * Rules for a SUPERVISOR changing an employee's time directly -- the
 * counterpart to an employee filing a correction and a supervisor approving it.
 *
 * Pure functions on purpose: no server imports, so the screen can use the very
 * same window the API enforces. A rule that exists twice drifts (KAN-28 and the
 * admin/supervisor permission split on the Employees page were both exactly
 * that), so there is one definition and both sides import it.
 */

/**
 * How far back a supervisor may edit, counted in calendar months including the
 * current one: 2 means this month and last month. Owner decision 2026-10-11
 * ("keep the editing for 1 month ... but for now let's stick with 2 months").
 * Deliberately one constant so tightening it to 1 later is a one-line change.
 *
 * Nothing stopped editing a closed payroll month before this existed -- an
 * employee could even file a correction against any date -- so this is the
 * first boundary the module has.
 */
export const SUPERVISOR_EDIT_MONTHS = 2;

export const MIN_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 500;

/**
 * Punch kinds a supervisor may ADD. The core four only. Overtime goes through
 * its own approval (wfm_ot_sessions) and must not be creatable here, and the
 * remote kinds are only ever corrected, never invented, because they carry a
 * claim about where the person was.
 */
export const ADDABLE_KINDS = ["check_in", "check_out", "break_start", "break_end"] as const;
export type AddableKind = (typeof ADDABLE_KINDS)[number];

/** First day (YYYY-MM-DD) of the oldest month a supervisor may still edit. */
export function editWindowStart(todayKey: string, months: number = SUPERVISOR_EDIT_MONTHS): string {
  const [y, m] = todayKey.slice(0, 10).split("-").map(Number);
  // Month arithmetic on an absolute index so January correctly reaches back
  // into the previous year rather than producing month 0 or -1.
  const idx = y * 12 + (m - 1) - (Math.max(1, months) - 1);
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}-01`;
}

/** Is `dayKey` inside the editable window, as of `todayKey`? Both YYYY-MM-DD in the tenant's timezone. */
export function isWithinEditWindow(dayKey: string, todayKey: string, months: number = SUPERVISOR_EDIT_MONTHS): boolean {
  return dayKey >= editWindowStart(todayKey, months) && dayKey <= todayKey.slice(0, 10);
}

export type ReasonCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * The explanation is the whole point of the feature -- it is what the employee
 * reads and what an audit asks for -- so a lone "." or "ok" is refused.
 */
export function checkReason(raw: unknown): ReasonCheck {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value.length < MIN_REASON_LENGTH) {
    return { ok: false, error: `Give a reason (at least ${MIN_REASON_LENGTH} characters) -- the employee will see it.` };
  }
  if (value.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `Keep the reason under ${MAX_REASON_LENGTH} characters.` };
  }
  return { ok: true, value };
}

/** A typed correction more than this far from the punch it replaces is almost certainly a wrong date or year. */
export const MAX_SHIFT_MS = 24 * 3600_000;

/** Slack for clocks that disagree, so "now" typed into the form is not rejected as the future. */
export const FUTURE_SLACK_MS = 5 * 60_000;

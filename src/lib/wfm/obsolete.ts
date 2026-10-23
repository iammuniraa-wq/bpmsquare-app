// "Obsolete" employees -- the one place that defines it (owner decision
// 2026-10-23, after a supervisor deleted an employee and the cascade took
// every punch with them). Nothing is stored beyond what employees already
// had: obsolete = status 'inactive' + valid_to set to the day it was made
// obsolete. Client-safe (no server imports) so the list screens, the pickers
// and the report builders all ask the same question the same way.
//
// Rule: an obsolete employee counts for every day up to AND INCLUDING
// valid_to, and for no day after it. An obsolete row with no valid_to (made
// inactive before this rule existed) has no date to count to, so it keeps
// behaving as it always did: excluded.

export type EmployeeValidity = {
  status?: string | null;
  valid_to?: string | null;
};

export const OBSOLETE_STATUS = "inactive";
export const OBSOLETE_WORD = "Obsolete";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isObsolete = (e: EmployeeValidity): boolean => e.status === OBSOLETE_STATUS;

/** The one word shown for the status everywhere: "Active" or "Obsolete" (the stored value stays 'inactive'). */
export const statusLabel = (e: EmployeeValidity): string => (isObsolete(e) ? OBSOLETE_WORD : "Active");

/** Does this employee count anywhere in the inclusive range from..to (YYYY-MM-DD)? */
export function isEmployeeInRange(e: EmployeeValidity, from: string, to: string): boolean {
  if (to < from) return false;
  if (!isObsolete(e)) return true;
  return !!e.valid_to && e.valid_to >= from;
}

/** Today as the browser sees it (YYYY-MM-DD), for pickers; reports use the tenant's own timezone on the server. */
export const localToday = (): string => new Date().toLocaleDateString("en-CA");

/** Does this employee count on the single day `date`? (Live board, pickers: pass today.) */
export const isEmployeeActiveOn = (e: EmployeeValidity, date: string): boolean => isEmployeeInRange(e, date, date);

/** The dates this employee counts on: an obsolete one loses every day after valid_to. */
export function clipDatesToValidity(dates: string[], e: EmployeeValidity): string[] {
  if (!isObsolete(e)) return dates;
  const end = e.valid_to;
  if (!end) return [];
  return dates.filter((d) => d <= end);
}

/** "Name (obsolete)" for an obsolete employee, the plain name otherwise. */
export const obsoleteLabel = (name: string, e: EmployeeValidity): string =>
  isObsolete(e) ? `${name} (${OBSOLETE_WORD.toLowerCase()})` : name;

/**
 * PostgREST `.or()` filter matching exactly the rows isEmployeeInRange keeps
 * for a range starting at `from`: every active employee, plus obsolete ones
 * whose valid_to is on or after `from`. Throws on a malformed date because
 * the string is spliced into a filter expression.
 */
export function inRangeOrFilter(from: string): string {
  if (!DATE_RE.test(from)) throw new Error("inRangeOrFilter: from must be YYYY-MM-DD");
  return `status.eq.active,and(status.eq.${OBSOLETE_STATUS},valid_to.gte.${from})`;
}

/**
 * Reports and history rows embed the employee as `employees: { first_name,
 * last_name, status }`. Appends " (obsolete)" to the displayed name so every
 * screen that joins first and last name shows it without knowing about this
 * rule. Returns new rows; the input is not mutated.
 */
export function markObsoleteEmbeds<T>(rows: T[] | null | undefined, key = "employees"): T[] {
  return (rows ?? []).map((row) => {
    const embed = (row as Record<string, unknown>)?.[key] as
      | { first_name?: string | null; last_name?: string | null; status?: string | null }
      | null
      | undefined;
    if (!embed || !isObsolete(embed)) return row;
    const suffix = ` (${OBSOLETE_WORD.toLowerCase()})`;
    const patched = embed.last_name?.trim()
      ? { ...embed, last_name: `${embed.last_name}${suffix}` }
      : { ...embed, first_name: `${embed.first_name ?? ""}${suffix}` };
    return { ...(row as object), [key]: patched } as T;
  });
}

/**
 * How valid_to follows a status change on a PATCH (owner decision 2026-10-23:
 * validity stays its own editable pair of fields; obsolete only USES valid_to).
 *
 * - Make obsolete (active -> inactive): valid_to becomes today when it is empty
 *   or in the future. An earlier valid_to is never overwritten.
 * - Make active again (inactive -> active): valid_to is cleared only when it is
 *   today or in the past. A future valid_to is left alone.
 * - A valid_to the caller changed in the same patch always wins (except that an
 *   obsolete employee must keep some date, so clearing it stamps today).
 *
 * Mutates and returns `patch`. Validity on an active employee is never touched.
 */
export function reconcileObsoletePatch(
  before: EmployeeValidity,
  patch: Record<string, unknown>,
  today: string
): Record<string, unknown> {
  const nextStatus = "status" in patch ? patch.status : before.status;
  const beforeTo = before.valid_to ?? null;
  const explicit = "valid_to" in patch && (patch.valid_to ?? null) !== beforeTo;

  if (nextStatus === OBSOLETE_STATUS) {
    if (explicit) {
      if (!patch.valid_to) patch.valid_to = today;
    } else if (!isObsolete(before) && (!beforeTo || beforeTo > today)) {
      patch.valid_to = today;
    } else if (isObsolete(before) && !beforeTo) {
      patch.valid_to = today;
    }
  } else if (isObsolete(before) && !explicit && beforeTo && beforeTo <= today) {
    patch.valid_to = null;
  }
  return patch;
}

/** Plain-words line for the "Make active again" confirm: what happens to valid_to. */
export function restoreNote(validTo: string | null | undefined, today: string): string {
  if (validTo && validTo <= today) return "The end date is cleared, so the employee counts again from today.";
  if (validTo) return "The end date is in the future and stays as it is.";
  return "";
}

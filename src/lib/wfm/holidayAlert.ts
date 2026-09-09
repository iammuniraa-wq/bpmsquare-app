// Pure helpers for the start-of-week holiday digest (BIM, 2026-09-10).
// No DB, no UI — unit-tested alongside the other WFM rule modules.

/** The seven-day window a digest covers, inclusive of both ends. */
export function holidayWeekWindow(todayKey: string): { from: string; to: string } {
  const start = new Date(`${todayKey}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { from: todayKey, to: end.toISOString().slice(0, 10) };
}

/**
 * Does a holiday row apply to this employee?
 *
 * wfm_holidays.applies_to is either 'all' or one employment-type code — the
 * same values employees.employment_type holds. An employee with no type set
 * only ever matches 'all', which is the conservative read: better to leave
 * someone off a "you have a day off" message than to promise one they don't get.
 */
export function holidayAppliesTo(appliesTo: string | null, employmentType: string | null): boolean {
  if (!appliesTo || appliesTo === "all") return true;
  return !!employmentType && appliesTo === employmentType;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Fri 18 Sep" — short, unambiguous, no year (the window is seven days).
 *
 * Formatted from fixed arrays rather than Intl on purpose: Intl's month
 * abbreviations are ICU-data dependent (Node renders en-GB September as
 * "Sept", browsers commonly "Sep"), so the same notification would read
 * differently depending on which runtime happened to build it.
 */
function shortDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (isNaN(d.getTime())) return dateKey;
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * The push body. Names every holiday with its date, because "there's a
 * holiday this week" without saying which day is a notification the reader
 * has to go and look something up after.
 */
export function holidayDigestBody(holidays: { date: string; name: string }[]): string {
  const ordered = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  return ordered.map((h) => `${shortDate(h.date)} — ${h.name}`).join(" · ");
}

/** "Holiday this week" / "2 holidays this week" — the push title. */
export function holidayDigestTitle(count: number): string {
  return count === 1 ? "Holiday this week" : `${count} holidays this week`;
}

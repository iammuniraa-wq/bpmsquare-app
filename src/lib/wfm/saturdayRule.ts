// 2nd-Saturday-of-the-month rule (owner decision 2026-09-09, BIM): every
// Saturday is a short day; the 2nd Saturday of the month is a full holiday
// instead. Pure date math only -- no DB access -- so it's shared safely by
// the punch route's live gate (api/wfm/punch/route.ts) and the generator
// (saturdayRosterServer.ts) alike. See WfmConfig.saturday_rule's own header
// comment (lib/constants.ts) for the full design.

function weekdayIndex(dateKey: string, timezone: string): number {
  const noon = new Date(`${dateKey}T12:00:00Z`); // safely mid-day, no DST/offset edge case
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(noon);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** Which Saturday of its month `dateKey` is (1-5), or null if it isn't one. */
export function nthSaturdayOfMonth(dateKey: string, timezone: string): number | null {
  if (weekdayIndex(dateKey, timezone) !== 6) return null;
  const day = Number(dateKey.slice(8, 10));
  return Math.ceil(day / 7);
}

/** The one Saturday a month that's a full holiday under this rule. */
export function isSecondSaturday(dateKey: string, timezone: string): boolean {
  return nthSaturdayOfMonth(dateKey, timezone) === 2;
}

/** Every Saturday in `yearMonth` (YYYY-MM), with which occurrence it is. */
export function saturdaysInMonth(yearMonth: string, timezone: string): { date: string; nth: number }[] {
  const [y, m] = yearMonth.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: { date: string; nth: number }[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${yearMonth}-${String(d).padStart(2, "0")}`;
    const nth = nthSaturdayOfMonth(dateKey, timezone);
    if (nth) out.push({ date: dateKey, nth });
  }
  return out;
}

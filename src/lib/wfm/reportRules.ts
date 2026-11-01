// Pure rules behind the BIM location-wise payroll report (CR-BIM-001). No DB and no server-only import, so the monthly
// summary, the Excel writer and the tests all share one definition of each rule.

/**
 * Overtime that counts for one day. `approvedMinutes` is the day's total APPROVED overtime; below the workspace minimum
 * it is shown but contributes nothing, at or above it the whole day counts (not only the part over the minimum). A
 * minimum of 0 (the default) is today's behaviour: every approved minute counts.
 */
export function otCountedMinutes(approvedMinutes: number, minMinutes: number): number {
  const min = Number.isFinite(minMinutes) ? Math.max(0, Math.floor(minMinutes)) : 0;
  return min > 0 && approvedMinutes > 0 && approvedMinutes < min ? 0 : approvedMinutes;
}

/** Length of a shift in minutes, across midnight when it ends before it starts ("HH:MM" or "HH:MM:SS"). */
export function shiftMinutes(shift: { start_time: string; end_time?: string | null }): number {
  if (!shift.end_time) return 0;
  const toMin = (t: string) => {
    const [h, m] = t.slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  };
  const start = toMin(shift.start_time);
  const end = toMin(shift.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return (end - start + 1440) % 1440;
}

/**
 * Standard hours for one day: the length of the shift the person was on (roster first, then their standing shift),
 * counted only for a day they were expected to work. Not counted: a weekly off or rostered day off, a holiday, a full
 * leave day (a half-day leave counts half), a day with no shift, or a day that has not happened yet (today counts once
 * the person has punched).
 *
 * The shift row carries no unpaid-break length, so nothing is taken off the shift; "Total Worked" is already net of the
 * breaks actually booked when the workspace deducts breaks. This is the figure to confirm with the client.
 */
export function standardMinutesForDay(i: {
  shift: { start_time: string; end_time?: string | null } | null;
  dayOff: boolean;
  weekOff: boolean;
  holiday: boolean;
  leave: { half_day: boolean } | null;
  date: string;
  todayKey: string;
  punches: number;
}): number {
  if (!i.shift || i.dayOff || i.weekOff || i.holiday) return 0;
  if (i.leave && !i.leave.half_day) return 0;
  if (!(i.date < i.todayKey || i.punches > 0)) return 0;
  const full = shiftMinutes(i.shift);
  return i.leave ? Math.round(full / 2) : full;
}

/** "08:15", or "-01:30" below standard. Text on purpose: an Excel duration format cannot show a negative time. */
export function formatSignedHM(minutes: number): string {
  const m = Math.round(minutes);
  const abs = Math.abs(m);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${m < 0 ? "-" : ""}${hh}:${mm}`;
}

/**
 * The message for an employment type the workspace has not set up. It names the allowed types so the person can fix
 * the value or add the type, instead of a bare "Invalid employment_type".
 */
export function employmentTypeError(value: string, types: readonly { code: string; label: string }[]): string {
  const allowed = types.map((t) => (t.label && t.label !== t.code ? `${t.label} (${t.code})` : t.code)).join(", ");
  return `Employment type '${value}' is not set up. Add it in Settings > Workforce or use one of: ${allowed}.`;
}

// ── Sheet names ──────────────────────────────────────────────────────────────

/** Excel: 31 characters at most, and : \ / ? * [ ] are illegal. */
export function cleanSheetName(raw: string): string {
  return raw.replace(/[:\\/?*[\]]/g, "-").trim().slice(0, 31);
}

/**
 * A name that is valid and not already taken (Excel compares sheet names case-insensitively). A clash gets " (2)",
 * " (3)" ... and the base is shortened so the suffix still fits in 31 characters.
 */
export function uniqueSheetName(raw: string, taken: Set<string>): string {
  const base = cleanSheetName(raw) || "Sheet";
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

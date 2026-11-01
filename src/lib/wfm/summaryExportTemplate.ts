import type { EmployeeDayRecord, EmployeeMonthSummary } from "./monthlySummary";
import { formatSignedHM } from "./reportRules";

// The ONE place the CA export's column layout lives. Requirements §5.6:
// "[ASSUMPTION] placeholder layout until sample received; build the export
// as a template-driven generator so swapping the layout is config, not
// code." When the real format arrives, edit this array (and, if the
// section/sheet split needs to change, src/app/api/wfm/summary/export/route.ts)
// -- the generator itself shouldn't need to change.

// Excel stores a duration as a fraction of a day. Paired with DURATION_FMT,
// 779 minutes renders as "12:59" while remaining a real number -- so the
// column still SUMs and can be multiplied (x24 gives decimal hours), which a
// "12h 59m" string could not.
//
// Declared ABOVE the column arrays on purpose: `numFmt: DURATION_FMT` is
// evaluated when each array is built, so a later declaration is a
// use-before-init error rather than a hoisting nicety.
const durationDays = (minutes: number) => minutes / 1440;

// Square brackets on the hour let it exceed 24 and keep counting (a month
// total of 375:25 rather than wrapping to 15:25), which plain "h:mm" gets
// silently wrong.
export const DURATION_FMT = "[h]:mm";

export type SummaryColumn = {
  header: string;
  width: number;
  accessor: (row: EmployeeMonthSummary, index: number) => string | number;
  /** A TOTAL-row value for a column that cannot be an Excel SUM (the Actual Hrs text). */
  total?: (rows: EmployeeMonthSummary[]) => string | number;
  /** Excel number format applied to the whole column. Used for the h:mm
   * duration columns -- see `durationDays`. */
  numFmt?: string;
  /** Include this column in a TOTAL / subtotal row. Flagged explicitly rather
   * than inferred from the header, so renaming a column can never silently
   * change what gets summed. */
  sum?: true;
};

export const MONTHLY_SUMMARY_COLUMNS: SummaryColumn[] = [
  { header: "Employee Code", width: 14, accessor: (r) => r.employee_code ?? "" },
  { header: "Name", width: 24, accessor: (r) => r.full_name },
  { header: "Site", width: 18, accessor: (r) => r.site_name ?? "" },
  { header: "Shift", width: 16, accessor: (r) => r.shift_name ?? "" },
  { header: "Days Present", width: 12, accessor: (r) => r.totals.days_present },
  { header: "Absent Days", width: 11, accessor: (r) => r.totals.absent_days },
  { header: "Working Hours", width: 13, accessor: (r) => durationDays(r.totals.working_minutes), numFmt: DURATION_FMT },
  { header: "Late Marks", width: 11, accessor: (r) => r.totals.late_marks },
  { header: "Half-Day Deductions", width: 16, accessor: (r) => r.totals.half_day_deductions },
  { header: "Paid Leave", width: 11, accessor: (r) => r.totals.paid_leave_days },
  { header: "Unpaid Leave", width: 12, accessor: (r) => r.totals.unpaid_leave_days },
  { header: "Holidays", width: 10, accessor: (r) => r.totals.holiday_days },
  { header: "Night Shifts", width: 12, accessor: (r) => r.totals.night_shifts },
  { header: "Night Allowance", width: 15, accessor: (r) => r.totals.night_allowance_total },
  // Overtime: APPROVED sessions only (pending/rejected never reach payroll),
  // priced on exact minutes at the tenant's flat rate -- no rounding up.
  { header: "OT Hours", width: 11, accessor: (r) => durationDays(r.totals.ot_minutes), numFmt: DURATION_FMT },
  { header: "OT Amount", width: 12, accessor: (r) => Math.round(r.totals.ot_amount * 100) / 100 },
  { header: "Incomplete Days", width: 14, accessor: (r) => r.totals.incomplete_days },
];

// ── Daily detail sheet ────────────────────────────────────────────────────
// One row per employee per day, with every break the employee actually
// booked spelled out — the backing evidence for the monthly roll-up above,
// so a CA (or the employee disputing a figure) can see exactly which punches
// produced it. `deductBreaks` is the tenant's config switch: it decides
// whether "Total Worked" is gross or gross − breaks, matching what
// getMonthlySummary already used to build the monthly Working Hours figure.

export type DailyDetailContext = {
  employee: EmployeeMonthSummary;
  day: EmployeeDayRecord;
  deductBreaks: boolean;
  timezone: string;
};

const hhmm = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

function dayStatus(d: EmployeeDayRecord): string {
  if (d.holiday) return `Holiday — ${d.holiday}`;
  if (d.on_leave) return `Leave — ${d.on_leave.name}`;
  if (d.is_week_off) return "Week off";
  if (d.incomplete) return "Incomplete";
  if (d.absent) return "Absent";
  if (d.late) return "Late";
  if (d.punches > 0) return "Present";
  return "";
}

export type DailyDetailColumn = {
  header: string;
  width: number;
  accessor: (ctx: DailyDetailContext) => string | number;
  numFmt?: string;
  sum?: true;
  /** Text for the per-employee subtotal row when the column cannot be an Excel SUM (the Actual Hrs text). */
  subtotal?: (days: EmployeeDayRecord[]) => string;
};

export const DAILY_DETAIL_COLUMNS: DailyDetailColumn[] = [
  { header: "Employee Code", width: 14, accessor: ({ employee }) => employee.employee_code ?? "" },
  { header: "Name", width: 24, accessor: ({ employee }) => employee.full_name },
  { header: "Site", width: 18, accessor: ({ employee }) => employee.site_name ?? "" },
  { header: "Date", width: 12, accessor: ({ day }) => day.date },
  // First in / last out stay for the common single-session case and for any
  // downstream sheet that keys off them; "Sessions"/"Session Times" is what
  // makes a day with more than one in/out pair readable, and is the figure
  // Total Worked is actually summed from.
  { header: "Check In", width: 10, accessor: ({ day, timezone }) => (day.first_in ? hhmm(day.first_in, timezone) : "") },
  { header: "Check Out", width: 10, accessor: ({ day, timezone }) => (day.last_out ? hhmm(day.last_out, timezone) : "") },
  { header: "Sessions", width: 9, accessor: ({ day }) => day.sessions.length },
  {
    header: "Session Times",
    width: 34,
    accessor: ({ day, timezone }) =>
      day.sessions
        .map((s, i) => `${i + 1}) ${hhmm(s.in, timezone)}-${s.out ? hhmm(s.out, timezone) : "open"}`)
        .join("  "),
  },
  { header: "Breaks Taken", width: 12, accessor: ({ day }) => day.breaks.length },
  {
    header: "Break Times",
    width: 40,
    accessor: ({ day, timezone }) =>
      day.breaks
        .map((b, i) => `${i + 1}) ${hhmm(b.start, timezone)}-${b.end ? hhmm(b.end, timezone) : "open"} (${b.minutes}m)`)
        .join("  "),
  },
  { header: "Break Hours", width: 12, accessor: ({ day }) => durationDays(day.break_minutes), numFmt: DURATION_FMT },
  { header: "Gross Hours", width: 12, accessor: ({ day }) => durationDays(day.gross_minutes), numFmt: DURATION_FMT },
  {
    header: "Total Worked",
    width: 13,
    accessor: ({ day, deductBreaks }) => durationDays(deductBreaks ? day.net_minutes : day.gross_minutes),
    numFmt: DURATION_FMT,
  },
  // APPROVED OT only, same rule as the monthly OT Hours column above --
  // pending/rejected sessions never reach this figure.
  { header: "OT Hours", width: 11, accessor: ({ day }) => durationDays(day.ot_counted_minutes), numFmt: DURATION_FMT },
  { header: "Status", width: 20, accessor: ({ day }) => dayStatus(day) },
];

// ── Payroll-format sheets ─────────────────────────────────────────────────
// A second presentation of the SAME figures, matching the layout the client's
// accountant already works from (sample received 2026-08-31). Added
// alongside the sheets above rather than replacing them: the existing sheets
// are the complete record, these two are the payroll-desk view.
//
// Two things differ from the sheets above, and both are the point:
//   1. One flat Summary across every employee with a TOTAL row, rather than
//      a sheet split per employment type. A payroll clerk wants one list and
//      one bottom line.
//   2. The daily data is grouped into a block PER EMPLOYEE with its own
//      subtotal, rather than one flat table -- that block is what gets read
//      out to an employee querying their own payslip.
// Every duration is h:mm (12:59), never decimal hours. The client's
// accountant kept reading 12.98 as "12 hours 98-something" when it is 12h
// 59m, and 8.18 as 8h 18m when it is 8h 11m (reported 2026-08-31). The cells
// are still real Excel durations, so they SUM and can be multiplied (x24
// gives decimal hours) -- the decimal is recoverable, the confusion is not
// worth keeping.

export const PAYROLL_SUMMARY_COLUMNS: SummaryColumn[] = [
  { header: "Employee Code", width: 14, accessor: (r) => r.employee_code ?? "" },
  { header: "Name", width: 24, accessor: (r) => r.full_name },
  { header: "Site", width: 20, accessor: (r) => r.site_name ?? "" },
  { header: "Days Present", width: 12, accessor: (r) => r.totals.days_present },
  { header: "Absent Days", width: 11, accessor: (r) => r.totals.absent_days },
  { header: "Paid Leave", width: 11, accessor: (r) => r.totals.paid_leave_days },
  { header: "Unpaid Leave", width: 12, accessor: (r) => r.totals.unpaid_leave_days },
  { header: "Half-Day Deductions", width: 16, accessor: (r) => r.totals.half_day_deductions },
  { header: "Late Marks", width: 11, accessor: (r) => r.totals.late_marks },
  { header: "Incomplete Days", width: 14, accessor: (r) => r.totals.incomplete_days },
  // Decimal for arithmetic, h:mm for humans. 12.98 hours reads as "almost 13
  // and a bit" -- it is 12h 59m. The client asked why a day showed 12.98
  // (2026-08-31); showing both units answers it permanently without changing
  // a single figure.
  { header: "Total Worked", width: 14, accessor: (r) => durationDays(r.totals.working_minutes), numFmt: DURATION_FMT },
  { header: "OT", width: 9, accessor: (r) => durationDays(r.totals.ot_minutes), numFmt: DURATION_FMT },
  { header: "OT Amount", width: 12, accessor: (r) => Math.round(r.totals.ot_amount * 100) / 100 },
];

/** Column indexes (1-based) of the numeric columns a TOTAL row sums. Name,
 * code and site are not summable, so they are excluded by position rather
 * than by guessing from the value type at runtime. */
export const PAYROLL_SUMMARY_TOTAL_FROM = 4;

/** Per-employee daily block. Deliberately short: date, the two clock times,
 * the three hour figures and a status. Anything more belongs on the Daily
 * Detail sheet, which is still in the workbook. */
export const PAYROLL_DAY_COLUMNS: DailyDetailColumn[] = [
  { header: "Date", width: 12, accessor: ({ day }) => day.date },
  {
    header: "Check In",
    width: 10,
    // Em dash rather than blank: an empty cell reads as "not filled in yet",
    // a dash reads as "there was no punch", which is the actual fact.
    accessor: ({ day, timezone }) => (day.first_in ? hhmm(day.first_in, timezone) : "—"),
  },
  {
    header: "Check Out",
    width: 10,
    accessor: ({ day, timezone }) => (day.last_out ? hhmm(day.last_out, timezone) : "—"),
  },
  { header: "Break", width: 10, accessor: ({ day }) => durationDays(day.break_minutes), numFmt: DURATION_FMT, sum: true },
  { header: "Gross", width: 10, accessor: ({ day }) => durationDays(day.gross_minutes), numFmt: DURATION_FMT, sum: true },
  {
    header: "Total Worked",
    width: 13,
    accessor: ({ day, deductBreaks }) => durationDays(deductBreaks ? day.net_minutes : day.gross_minutes),
    numFmt: DURATION_FMT,
    sum: true,
  },
  { header: "OT", width: 9, accessor: ({ day }) => durationDays(day.ot_counted_minutes), numFmt: DURATION_FMT, sum: true },
  { header: "Status", width: 20, accessor: ({ day }) => dayStatus(day) },
];

/** 1-based indexes of the columns a per-employee subtotal sums. Derived from
 * the headers rather than hardcoded, so inserting a column can never silently
 * make the subtotals sum the wrong thing. */
export const PAYROLL_DAY_SUM_COLUMNS = PAYROLL_DAY_COLUMNS
  .map((c, i) => ({ c, n: i + 1 }))
  .filter(({ c }) => c.sum)
  .map(({ n }) => n);

// ── Location-wise report (CR-BIM-001) ────────────────────────────────────────
// The sheets above are exactly what the export has always produced. A workspace
// that switches on `payroll_by_location` and/or sets an OT minimum gets the
// same columns plus the extras below, built by these functions. With both off,
// every function returns the constant arrays above untouched, so the default
// workbook cannot drift.

export type ReportOptions = {
  /** payroll_by_location: Sl No, Category, Standard Hrs and Actual Hrs are added. */
  byLocation: boolean;
  /** ot_min_minutes > 0: an "OT not counted" column and a note on the day's status. */
  showOtNotCounted: boolean;
  /** Label for an employment-type code (the Category column). */
  typeLabel: (code: string) => string;
};

export const PLAIN_REPORT_OPTIONS: ReportOptions = { byLocation: false, showOtNotCounted: false, typeLabel: (c) => c };

export function reportOptionsFor(
  config: { payroll_by_location?: boolean; ot_min_minutes?: number; employment_types: { code: string; label: string }[] }
): ReportOptions {
  const labels = new Map(config.employment_types.map((t) => [t.code, t.label]));
  return {
    byLocation: config.payroll_by_location === true,
    showOtNotCounted: (config.ot_min_minutes ?? 0) > 0,
    typeLabel: (code) => labels.get(code) ?? code,
  };
}

const isPlain = (o: ReportOptions) => !o.byLocation && !o.showOtNotCounted;

const SL_NO: SummaryColumn = { header: "Sl No", width: 7, accessor: (_r, i) => i + 1 };
const sumActual = (rows: EmployeeMonthSummary[]) => formatSignedHM(rows.reduce((s, r) => s + r.totals.actual_minutes, 0));

/** Insert `add` right after the column headed `after` (or at the end if there is none). */
function insertAfter<T extends { header: string }>(cols: T[], after: string, add: T[]): T[] {
  const i = cols.findIndex((c) => c.header === after);
  return i < 0 ? [...cols, ...add] : [...cols.slice(0, i + 1), ...add, ...cols.slice(i + 1)];
}

/** Per-type / per-location section sheet columns. */
export function sectionColumns(o: ReportOptions): SummaryColumn[] {
  if (isPlain(o)) return MONTHLY_SUMMARY_COLUMNS;
  let cols = MONTHLY_SUMMARY_COLUMNS;
  if (o.byLocation) {
    cols = insertAfter(cols, "Name", [{ header: "Category", width: 16, accessor: (r) => o.typeLabel(r.employment_type) }]);
    cols = insertAfter(cols, "Working Hours", [
      { header: "Standard Hrs", width: 13, accessor: (r) => durationDays(r.totals.standard_minutes), numFmt: DURATION_FMT },
      { header: "Actual Hrs", width: 12, accessor: (r) => formatSignedHM(r.totals.actual_minutes), total: sumActual },
    ]);
  }
  if (o.showOtNotCounted) {
    cols = insertAfter(cols, "OT Hours", [
      { header: "OT not counted", width: 14, accessor: (r) => durationDays(r.totals.ot_not_counted_minutes), numFmt: DURATION_FMT },
    ]);
  }
  return o.byLocation ? [SL_NO, ...cols] : cols;
}

/** Flat payroll Summary columns and the 1-based column its TOTAL row starts summing from. */
export function payrollSummaryColumns(o: ReportOptions): { columns: SummaryColumn[]; totalFrom: number } {
  if (isPlain(o)) return { columns: PAYROLL_SUMMARY_COLUMNS, totalFrom: PAYROLL_SUMMARY_TOTAL_FROM };
  let cols = PAYROLL_SUMMARY_COLUMNS;
  if (o.byLocation) {
    cols = insertAfter(cols, "Name", [{ header: "Category", width: 16, accessor: (r) => o.typeLabel(r.employment_type) }]);
    cols = insertAfter(cols, "Total Worked", [
      { header: "Standard Hrs", width: 13, accessor: (r) => durationDays(r.totals.standard_minutes), numFmt: DURATION_FMT },
      { header: "Actual Hrs", width: 12, accessor: (r) => formatSignedHM(r.totals.actual_minutes), total: sumActual },
    ]);
  }
  if (o.showOtNotCounted) {
    cols = insertAfter(cols, "OT", [
      { header: "OT not counted", width: 14, accessor: (r) => durationDays(r.totals.ot_not_counted_minutes), numFmt: DURATION_FMT },
    ]);
  }
  if (o.byLocation) cols = [SL_NO, ...cols];
  // The TOTAL row starts at the first numeric column, "Days Present", wherever the added text columns pushed it.
  return { columns: cols, totalFrom: cols.findIndex((c) => c.header === "Days Present") + 1 };
}

const OT_NOTE = "OT below minimum, not counted";
const statusWithOtNote = (d: EmployeeDayRecord) => {
  const base = dayStatus(d);
  return d.ot_below_minimum ? (base ? `${base} — ${OT_NOTE}` : OT_NOTE) : base;
};
const otNotCountedDay = (day: EmployeeDayRecord) => durationDays(day.ot_minutes - day.ot_counted_minutes);
const sumDayActual = (days: EmployeeDayRecord[]) => formatSignedHM(days.reduce((s, d) => s + d.actual_minutes, 0));

function withDayExtras(base: DailyDetailColumn[], o: ReportOptions, after: { worked: string; ot: string; status: string }): DailyDetailColumn[] {
  let cols = base;
  if (o.byLocation) {
    cols = insertAfter(cols, after.worked, [
      { header: "Standard Hrs", width: 13, accessor: ({ day }) => durationDays(day.standard_minutes), numFmt: DURATION_FMT, sum: true },
      { header: "Actual Hrs", width: 12, accessor: ({ day }) => formatSignedHM(day.actual_minutes), subtotal: sumDayActual },
    ]);
  }
  if (o.showOtNotCounted) {
    cols = insertAfter(cols, after.ot, [
      { header: "OT not counted", width: 14, accessor: ({ day }) => otNotCountedDay(day), numFmt: DURATION_FMT, sum: true },
    ]);
    cols = cols.map((c) => (c.header === after.status ? { ...c, width: 34, accessor: ({ day }: DailyDetailContext) => statusWithOtNote(day) } : c));
  }
  return cols;
}

export function dailyDetailColumns(o: ReportOptions): DailyDetailColumn[] {
  if (isPlain(o)) return DAILY_DETAIL_COLUMNS;
  return withDayExtras(DAILY_DETAIL_COLUMNS, o, { worked: "Total Worked", ot: "OT Hours", status: "Status" });
}

export function payrollDayColumns(o: ReportOptions): DailyDetailColumn[] {
  if (isPlain(o)) return PAYROLL_DAY_COLUMNS;
  return withDayExtras(PAYROLL_DAY_COLUMNS, o, { worked: "Total Worked", ot: "OT", status: "Status" });
}


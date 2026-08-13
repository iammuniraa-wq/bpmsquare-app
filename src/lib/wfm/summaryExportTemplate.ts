import type { EmployeeDayRecord, EmployeeMonthSummary } from "./monthlySummary";

// The ONE place the CA export's column layout lives. Requirements §5.6:
// "[ASSUMPTION] placeholder layout until sample received; build the export
// as a template-driven generator so swapping the layout is config, not
// code." When the real format arrives, edit this array (and, if the
// section/sheet split needs to change, src/app/api/wfm/summary/export/route.ts)
// -- the generator itself shouldn't need to change.

export type SummaryColumn = {
  header: string;
  width: number;
  accessor: (row: EmployeeMonthSummary) => string | number;
};

export const MONTHLY_SUMMARY_COLUMNS: SummaryColumn[] = [
  { header: "Employee Code", width: 14, accessor: (r) => r.employee_code ?? "" },
  { header: "Name", width: 24, accessor: (r) => r.full_name },
  { header: "Site", width: 18, accessor: (r) => r.site_name ?? "" },
  { header: "Shift", width: 16, accessor: (r) => r.shift_name ?? "" },
  { header: "Days Present", width: 12, accessor: (r) => r.totals.days_present },
  { header: "Absent Days", width: 11, accessor: (r) => r.totals.absent_days },
  { header: "Working Hours", width: 13, accessor: (r) => Math.round((r.totals.working_minutes / 60) * 100) / 100 },
  { header: "Late Marks", width: 11, accessor: (r) => r.totals.late_marks },
  { header: "Half-Day Deductions", width: 16, accessor: (r) => r.totals.half_day_deductions },
  { header: "Paid Leave", width: 11, accessor: (r) => r.totals.paid_leave_days },
  { header: "Unpaid Leave", width: 12, accessor: (r) => r.totals.unpaid_leave_days },
  { header: "Holidays", width: 10, accessor: (r) => r.totals.holiday_days },
  { header: "Night Shifts", width: 12, accessor: (r) => r.totals.night_shifts },
  { header: "Night Allowance", width: 15, accessor: (r) => r.totals.night_allowance_total },
  // Overtime: APPROVED sessions only (pending/rejected never reach payroll),
  // priced on exact minutes at the tenant's flat rate -- no rounding up.
  { header: "OT Hours", width: 11, accessor: (r) => Math.round((r.totals.ot_minutes / 60) * 100) / 100 },
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

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

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
  { header: "Break Hours", width: 12, accessor: ({ day }) => hours(day.break_minutes) },
  { header: "Gross Hours", width: 12, accessor: ({ day }) => hours(day.gross_minutes) },
  {
    header: "Total Worked",
    width: 13,
    accessor: ({ day, deductBreaks }) => hours(deductBreaks ? day.net_minutes : day.gross_minutes),
  },
  { header: "Status", width: 20, accessor: ({ day }) => dayStatus(day) },
];

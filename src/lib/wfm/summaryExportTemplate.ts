import type { EmployeeMonthSummary } from "./monthlySummary";

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
  { header: "Working Hours", width: 13, accessor: (r) => Math.round((r.totals.working_minutes / 60) * 100) / 100 },
  { header: "Late Marks", width: 11, accessor: (r) => r.totals.late_marks },
  { header: "Half-Day Deductions", width: 16, accessor: (r) => r.totals.half_day_deductions },
  { header: "Paid Leave", width: 11, accessor: (r) => r.totals.paid_leave_days },
  { header: "Unpaid Leave", width: 12, accessor: (r) => r.totals.unpaid_leave_days },
  { header: "Holidays", width: 10, accessor: (r) => r.totals.holiday_days },
  { header: "Night Shifts", width: 12, accessor: (r) => r.totals.night_shifts },
  { header: "Night Allowance", width: 15, accessor: (r) => r.totals.night_allowance_total },
  { header: "Incomplete Days", width: 14, accessor: (r) => r.totals.incomplete_days },
];

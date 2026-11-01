import ExcelJS from "exceljs";
import type { WfmConfig } from "@/lib/constants";
import type { EmployeeMonthSummary } from "./monthlySummary";
import {
  dailyDetailColumns, payrollDayColumns, payrollSummaryColumns, reportOptionsFor, sectionColumns,
  type DailyDetailColumn, type ReportOptions, type SummaryColumn,
} from "./summaryExportTemplate";
import { locationSheetName, uniqueSheetName } from "./reportRules";

// The CA-facing Excel export, built from already-computed month summaries. Lives here (not in the route) so the
// default layout and the location-wise layout (WfmConfig.payroll_by_location) can both be tested against real
// summaries without an HTTP request. The route only authenticates, loads data and streams the buffer.

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF152233" } };

/** Shown for people with no site when the report is organised by location. */
export const NO_LOCATION_LABEL = "No location";

function writeSection(sheet: ExcelJS.Worksheet, title: string, rows: EmployeeMonthSummary[], columns: SummaryColumn[]) {
  // Width only, never `header` -- assigning a header here makes ExcelJS
  // auto-insert its own header row, which duplicated the explicit one added
  // below (the stray first row in every export until this fix).
  sheet.columns = columns.map((c) => ({ width: c.width }));
  columns.forEach((c, i) => { if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt; });

  const titleRow = sheet.addRow([title]);
  titleRow.font = { bold: true, size: 13 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, columns.length);

  const headerRow = sheet.addRow(columns.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
  });

  if (rows.length === 0) {
    sheet.addRow(["No employees in this section for the selected period."]);
  }
  rows.forEach((r, i) => {
    sheet.addRow(columns.map((c) => c.accessor(r, i)));
  });
  sheet.addRow([]); // spacer before the next section, if any
}

function writeDailyDetail(
  sheet: ExcelJS.Worksheet,
  title: string,
  rows: EmployeeMonthSummary[],
  deductBreaks: boolean,
  timezone: string,
  columns: DailyDetailColumn[]
) {
  sheet.columns = columns.map((c) => ({ width: c.width }));
  columns.forEach((c, i) => { if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt; });

  const titleRow = sheet.addRow([title]);
  titleRow.font = { bold: true, size: 13 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, columns.length);

  const noteRow = sheet.addRow([
    deductBreaks
      ? "Total Worked = Check Out − Check In − break time (tenant setting: breaks are deducted)."
      : "Total Worked = Check Out − Check In (tenant setting: breaks are NOT deducted).",
  ]);
  noteRow.font = { italic: true, size: 10 };
  sheet.mergeCells(noteRow.number, 1, noteRow.number, columns.length);

  const headerRow = sheet.addRow(columns.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
  });

  let wrote = 0;
  for (const employee of rows) {
    // Skip days with nothing to report -- an untouched future/week-off day
    // per employee would bury the real rows.
    const days = employee.days.filter((d) => d.punches > 0 || d.on_leave || d.holiday || d.absent);
    for (const day of days) {
      sheet.addRow(columns.map((c) => c.accessor({ employee, day, deductBreaks, timezone })));
      wrote++;
    }
  }
  if (wrote === 0) sheet.addRow(["No attendance recorded for the selected period."]);
}

/**
 * Payroll Summary — one flat list of every employee with a grand TOTAL row,
 * in the layout the client's accountant already works from. Deliberately not
 * split by employment type (unlike writeSection): a payroll clerk wants one
 * list and one bottom line.
 */
function writePayrollSummary(
  sheet: ExcelJS.Worksheet,
  label: string,
  tenantName: string,
  rows: EmployeeMonthSummary[],
  columns: SummaryColumn[],
  totalFrom: number
) {
  sheet.columns = columns.map((c) => ({ width: c.width }));
  columns.forEach((c, i) => { if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt; });

  const titleRow = sheet.addRow([`Payroll Summary — ${label}`]);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, columns.length);

  const subRow = sheet.addRow([`${tenantName}  |  Generated from BPMSquare WFM attendance`]);
  subRow.font = { italic: true, size: 10, color: { argb: "FF666666" } };
  sheet.mergeCells(subRow.number, 1, subRow.number, columns.length);

  sheet.addRow([]);

  const headerRow = sheet.addRow(columns.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
  });

  if (rows.length === 0) {
    sheet.addRow(["No employees for the selected period."]);
    return;
  }

  const firstDataRow = headerRow.number + 1;
  rows.forEach((r, i) => sheet.addRow(columns.map((c) => c.accessor(r, i))));
  const lastDataRow = firstDataRow + rows.length - 1;

  // Live SUM formulas rather than a number computed here: the clerk almost
  // always filters or deletes rows, and a hardcoded total would then be
  // silently wrong while still looking authoritative. A text column (Actual
  // Hrs, which can be negative) cannot be summed by Excel, so it carries a
  // computed total instead.
  const total: (string | number | { formula: string })[] = ["TOTAL"];
  while (total.length < totalFrom - 1) total.push("");
  for (let col = totalFrom; col <= columns.length; col++) {
    const colDef = columns[col - 1];
    if (colDef.total) {
      total.push(colDef.total(rows));
    } else {
      const letter = sheet.getColumn(col).letter;
      total.push({ formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` });
    }
  }
  const totalRow = sheet.addRow(total);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.border = { top: { style: "thin" } };
  });

  sheet.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: lastDataRow, column: columns.length } };
  sheet.views = [{ state: "frozen", ySplit: headerRow.number }];
}

/**
 * Payroll Report — the same daily figures as the Daily Detail sheet, but
 * grouped into a block per employee with its own subtotal. That block is
 * what gets read out to an employee querying their payslip, which a flat
 * table makes needlessly hard.
 */
function writePayrollReport(
  sheet: ExcelJS.Worksheet,
  label: string,
  tenantName: string,
  rows: EmployeeMonthSummary[],
  deductBreaks: boolean,
  timezone: string,
  columns: DailyDetailColumn[],
  opts: ReportOptions
) {
  sheet.columns = columns.map((c) => ({ width: c.width }));
  columns.forEach((c, i) => { if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt; });
  const width = columns.length;

  const titleRow = sheet.addRow([`Employee-wise Attendance & Payroll Detail — ${label}`]);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, width);

  const noteRow = sheet.addRow([
    (deductBreaks
      ? "Total Worked = Check Out − Check In − break time (tenant setting: breaks are deducted)."
      : "Total Worked = Check Out − Check In (tenant setting: breaks are NOT deducted).") +
      `  |  ${tenantName}`,
  ]);
  noteRow.font = { italic: true, size: 10, color: { argb: "FF666666" } };
  sheet.mergeCells(noteRow.number, 1, noteRow.number, width);

  if (rows.length === 0) {
    sheet.addRow([]);
    sheet.addRow(["No attendance recorded for the selected period."]);
    return;
  }

  const summedCols = columns.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => c.sum || c.subtotal).map(({ n }) => n);
  const lastSummed = Math.max(...summedCols);

  rows.forEach((employee, index) => {
    sheet.addRow([]);

    // A serial and the category sit in the heading line: the block is one person, so there is no column to number.
    const who = (opts.byLocation
      ? [`Sl No ${index + 1}`, employee.employee_code, employee.full_name, employee.site_name, opts.typeLabel(employee.employment_type)]
      : [employee.employee_code, employee.full_name, employee.site_name]
    ).filter(Boolean).join("   |   ");
    const empRow = sheet.addRow([who]);
    empRow.font = { bold: true, size: 11.5 };
    empRow.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1F8" } }; });
    sheet.mergeCells(empRow.number, 1, empRow.number, width);

    const headerRow = sheet.addRow(columns.map((c) => c.header));
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = HEADER_FILL;
    });

    // Same filter as the Daily Detail sheet: a month of untouched future and
    // week-off rows per employee would bury the days that actually matter.
    const days = employee.days.filter((d) => d.punches > 0 || d.on_leave || d.holiday || d.absent);
    if (days.length === 0) {
      sheet.addRow(["No attendance recorded in this period."]);
      return;
    }
    const firstDataRow = headerRow.number + 1;
    for (const day of days) {
      sheet.addRow(columns.map((c) => c.accessor({ employee, day, deductBreaks, timezone })));
    }
    const lastDataRow = firstDataRow + days.length - 1;

    const subtotal: (string | { formula: string })[] = ["Employee Total"];
    // Pad up to the first summed column so the label and the sums line up
    // regardless of how many leading text columns there are.
    while (subtotal.length < summedCols[0] - 1) subtotal.push("");
    for (let col = summedCols[0]; col <= lastSummed; col++) {
      const colDef = columns[col - 1];
      if (colDef.sum) {
        const letter = sheet.getColumn(col).letter;
        subtotal.push({ formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` });
      } else {
        subtotal.push(colDef.subtotal ? colDef.subtotal(days) : "");
      }
    }
    const subtotalRow = sheet.addRow(subtotal);
    subtotalRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.border = { top: { style: "thin" } };
    });
  });
}

const byCodeThenName = (a: EmployeeMonthSummary, b: EmployeeMonthSummary) =>
  (a.employee_code ?? "").localeCompare(b.employee_code ?? "") || a.full_name.localeCompare(b.full_name);

export type SummaryWorkbookInput = {
  summaries: EmployeeMonthSummary[];
  config: Pick<WfmConfig, "employment_types" | "deduct_breaks" | "timezone" | "payroll_by_location" | "ot_min_minutes">;
  /** "October 2026", or the custom range. */
  label: string;
  tenantName: string;
};

/** One section sheet's worth of people: the title it carries and the sheet name it gets. */
type SectionPlan = { sheetName: string; title: string; rows: EmployeeMonthSummary[] };

/**
 * The per-type sheets as they have always been: one per CONFIGURED employment type (empty ones included, so a tenant
 * that adds "Intern" gets its sheet), then an "Other" sheet for any stored type no longer in the list, so nobody falls
 * off the payroll export.
 */
function planByType(input: SummaryWorkbookInput): SectionPlan[] {
  const { summaries, config, label } = input;
  const plans: SectionPlan[] = [];
  const configuredCodes = new Set(config.employment_types.map((t) => t.code));
  for (const type of config.employment_types) {
    plans.push({
      // Excel sheet names: 31 chars max, and : \ / ? * [ ] are illegal.
      sheetName: type.label.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || type.code.slice(0, 31),
      title: `Attendance Summary — ${label} — ${type.label}`,
      rows: summaries.filter((s) => s.employment_type === type.code),
    });
  }
  const unclassified = summaries.filter((s) => !configuredCodes.has(s.employment_type));
  if (unclassified.length > 0) {
    plans.push({ sheetName: "Other", title: `Attendance Summary — ${label} — Other`, rows: unclassified });
  }
  return plans;
}

/**
 * Location-wise: one sheet per (location, employment type) that has people, named "<Location> - <Type>". A person with
 * no site goes to "No location - <Type>". A stored type missing from the configured list goes to "<Location> - Other"
 * (per location, the same shape as every other sheet, rather than one Other sheet that mixes sites). Locations are
 * ordered by name with "No location" last; types follow the configured order, Other last.
 */
function planByLocation(input: SummaryWorkbookInput): SectionPlan[] {
  const { summaries, config, label } = input;
  const configuredCodes = new Set(config.employment_types.map((t) => t.code));
  const typeSlots = [...config.employment_types.map((t) => ({ code: t.code as string | null, label: t.label || t.code })), { code: null, label: "Other" }];

  const locations = new Map<string, { name: string; rows: EmployeeMonthSummary[] }>();
  for (const s of summaries) {
    const key = s.site_id ?? "";
    const loc = locations.get(key) ?? { name: s.site_id ? (s.site_name ?? NO_LOCATION_LABEL) : NO_LOCATION_LABEL, rows: [] };
    loc.rows.push(s);
    locations.set(key, loc);
  }
  const ordered = [...locations.entries()].sort(([ka, a], [kb, b]) =>
    ka === "" ? 1 : kb === "" ? -1 : a.name.localeCompare(b.name) || ka.localeCompare(kb));

  const taken = new Set<string>();
  const plans: SectionPlan[] = [];
  for (const [, loc] of ordered) {
    for (const slot of typeSlots) {
      const rows = loc.rows.filter((r) => (slot.code === null ? !configuredCodes.has(r.employment_type) : r.employment_type === slot.code));
      if (rows.length === 0) continue;
      plans.push({
        sheetName: uniqueSheetName(locationSheetName(loc.name, slot.label), taken),
        title: `Attendance Summary — ${label} — ${loc.name} — ${slot.label}`,
        rows,
      });
    }
  }
  return plans;
}

/**
 * Fill `workbook` with the export. Payroll-desk sheets first (Summary, Payroll Report), then the per-type or
 * per-location section sheets, then Daily Detail. With `payroll_by_location` off and no OT minimum the sheets, headers
 * and cells are exactly the original export's.
 */
export function buildSummaryWorkbook(workbook: ExcelJS.Workbook, input: SummaryWorkbookInput): ExcelJS.Workbook {
  const { summaries, config, label, tenantName } = input;
  const opts = reportOptionsFor(config);
  const payrollRows = [...summaries].sort(byCodeThenName);

  const summaryCols = payrollSummaryColumns(opts);
  writePayrollSummary(workbook.addWorksheet("Summary"), label, tenantName, payrollRows, summaryCols.columns, summaryCols.totalFrom);
  writePayrollReport(
    workbook.addWorksheet("Payroll Report"),
    label, tenantName, payrollRows, config.deduct_breaks, config.timezone, payrollDayColumns(opts), opts
  );

  // Original order inside a per-type sheet is kept as it was; the location sheets are sorted by code then name.
  const plans = opts.byLocation ? planByLocation({ ...input, summaries: payrollRows }) : planByType(input);
  const columns = sectionColumns(opts);
  for (const plan of plans) {
    writeSection(workbook.addWorksheet(plan.sheetName), plan.title, plan.rows, columns);
  }

  writeDailyDetail(
    workbook.addWorksheet("Daily Detail"),
    `Daily Attendance Detail — ${label}`,
    summaries,
    config.deduct_breaks,
    config.timezone,
    dailyDetailColumns(opts)
  );
  return workbook;
}

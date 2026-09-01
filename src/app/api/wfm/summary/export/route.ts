import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getMonthlySummary, type EmployeeMonthSummary } from "@/lib/wfm/monthlySummary";
import {
  MONTHLY_SUMMARY_COLUMNS, DAILY_DETAIL_COLUMNS,
  PAYROLL_SUMMARY_COLUMNS, PAYROLL_SUMMARY_TOTAL_FROM, PAYROLL_DAY_COLUMNS,
  PAYROLL_DAY_SUM_COLUMNS,
} from "@/lib/wfm/summaryExportTemplate";

const MONTH_RE = /^\d{4}-\d{2}$/;
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF152233" } };

function writeSection(sheet: ExcelJS.Worksheet, title: string, rows: EmployeeMonthSummary[]) {
  // Width only, never `header` -- assigning a header here makes ExcelJS
  // auto-insert its own header row, which duplicated the explicit one added
  // below (the stray first row in every export until this fix).
  sheet.columns = MONTHLY_SUMMARY_COLUMNS.map((c) => ({ width: c.width }));
  MONTHLY_SUMMARY_COLUMNS.forEach((c, i) => { if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt; });

  const titleRow = sheet.addRow([title]);
  titleRow.font = { bold: true, size: 13 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, MONTHLY_SUMMARY_COLUMNS.length);

  const headerRow = sheet.addRow(MONTHLY_SUMMARY_COLUMNS.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
  });

  if (rows.length === 0) {
    sheet.addRow(["No employees in this section for the selected month."]);
  }
  for (const r of rows) {
    sheet.addRow(MONTHLY_SUMMARY_COLUMNS.map((c) => c.accessor(r)));
  }
  sheet.addRow([]); // spacer before the next section, if any
}

function writeDailyDetail(
  sheet: ExcelJS.Worksheet,
  title: string,
  rows: EmployeeMonthSummary[],
  deductBreaks: boolean,
  timezone: string
) {
  sheet.columns = DAILY_DETAIL_COLUMNS.map((c) => ({ width: c.width }));
  DAILY_DETAIL_COLUMNS.forEach((c, i) => { if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt; });

  const titleRow = sheet.addRow([title]);
  titleRow.font = { bold: true, size: 13 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, DAILY_DETAIL_COLUMNS.length);

  const noteRow = sheet.addRow([
    deductBreaks
      ? "Total Worked = Check Out − Check In − break time (tenant setting: breaks are deducted)."
      : "Total Worked = Check Out − Check In (tenant setting: breaks are NOT deducted).",
  ]);
  noteRow.font = { italic: true, size: 10 };
  sheet.mergeCells(noteRow.number, 1, noteRow.number, DAILY_DETAIL_COLUMNS.length);

  const headerRow = sheet.addRow(DAILY_DETAIL_COLUMNS.map((c) => c.header));
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
      sheet.addRow(DAILY_DETAIL_COLUMNS.map((c) => c.accessor({ employee, day, deductBreaks, timezone })));
      wrote++;
    }
  }
  if (wrote === 0) sheet.addRow(["No attendance recorded for the selected month."]);
}

/**
 * Payroll Summary — one flat list of every employee with a grand TOTAL row,
 * in the layout the client's accountant already works from. Deliberately not
 * split by employment type (unlike writeSection): a payroll clerk wants one
 * list and one bottom line.
 */
function writePayrollSummary(
  sheet: ExcelJS.Worksheet,
  month: string,
  tenantName: string,
  rows: EmployeeMonthSummary[]
) {
  sheet.columns = PAYROLL_SUMMARY_COLUMNS.map((c) => ({ width: c.width }));
  PAYROLL_SUMMARY_COLUMNS.forEach((c, i) => { if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt; });

  const titleRow = sheet.addRow([`Monthly Payroll Summary — ${monthLabel(month)}`]);
  titleRow.font = { bold: true, size: 14 };
  sheet.mergeCells(titleRow.number, 1, titleRow.number, PAYROLL_SUMMARY_COLUMNS.length);

  const subRow = sheet.addRow([`${tenantName}  |  Generated from BPMSquare WFM attendance`]);
  subRow.font = { italic: true, size: 10, color: { argb: "FF666666" } };
  sheet.mergeCells(subRow.number, 1, subRow.number, PAYROLL_SUMMARY_COLUMNS.length);

  sheet.addRow([]);

  const headerRow = sheet.addRow(PAYROLL_SUMMARY_COLUMNS.map((c) => c.header));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
  });

  if (rows.length === 0) {
    sheet.addRow(["No employees for the selected month."]);
    return;
  }

  const firstDataRow = headerRow.number + 1;
  for (const r of rows) sheet.addRow(PAYROLL_SUMMARY_COLUMNS.map((c) => c.accessor(r)));
  const lastDataRow = firstDataRow + rows.length - 1;

  // Live SUM formulas rather than a number computed here: the clerk almost
  // always filters or deletes rows, and a hardcoded total would then be
  // silently wrong while still looking authoritative.
  const total: (string | { formula: string })[] = ["TOTAL", "", ""];
  for (let col = PAYROLL_SUMMARY_TOTAL_FROM; col <= PAYROLL_SUMMARY_COLUMNS.length; col++) {
    const letter = sheet.getColumn(col).letter;
    total.push({ formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` });
  }
  const totalRow = sheet.addRow(total);
  totalRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.border = { top: { style: "thin" } };
  });

  sheet.autoFilter = { from: { row: headerRow.number, column: 1 }, to: { row: lastDataRow, column: PAYROLL_SUMMARY_COLUMNS.length } };
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
  month: string,
  tenantName: string,
  rows: EmployeeMonthSummary[],
  deductBreaks: boolean,
  timezone: string
) {
  sheet.columns = PAYROLL_DAY_COLUMNS.map((c) => ({ width: c.width }));
  PAYROLL_DAY_COLUMNS.forEach((c, i) => { if (c.numFmt) sheet.getColumn(i + 1).numFmt = c.numFmt; });
  const width = PAYROLL_DAY_COLUMNS.length;

  const titleRow = sheet.addRow([`Employee-wise Attendance & Payroll Detail — ${monthLabel(month)}`]);
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
    sheet.addRow(["No attendance recorded for the selected month."]);
    return;
  }

  for (const employee of rows) {
    sheet.addRow([]);

    const who = [employee.employee_code, employee.full_name, employee.site_name]
      .filter(Boolean).join("   |   ");
    const empRow = sheet.addRow([who]);
    empRow.font = { bold: true, size: 11.5 };
    empRow.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1F8" } }; });
    sheet.mergeCells(empRow.number, 1, empRow.number, width);

    const headerRow = sheet.addRow(PAYROLL_DAY_COLUMNS.map((c) => c.header));
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = HEADER_FILL;
    });

    // Same filter as the Daily Detail sheet: a month of untouched future and
    // week-off rows per employee would bury the days that actually matter.
    const days = employee.days.filter((d) => d.punches > 0 || d.on_leave || d.holiday || d.absent);
    if (days.length === 0) {
      sheet.addRow(["No attendance recorded this month."]);
      continue;
    }
    const firstDataRow = headerRow.number + 1;
    for (const day of days) {
      sheet.addRow(PAYROLL_DAY_COLUMNS.map((c) => c.accessor({ employee, day, deductBreaks, timezone })));
    }
    const lastDataRow = firstDataRow + days.length - 1;

    const subtotal: (string | { formula: string })[] = ["Employee Total"];
    // Pad up to the first summed column so the label and the sums line up
    // regardless of how many leading text columns there are.
    while (subtotal.length < PAYROLL_DAY_SUM_COLUMNS[0] - 1) subtotal.push("");
    for (const col of PAYROLL_DAY_SUM_COLUMNS) {
      const letter = sheet.getColumn(col).letter;
      subtotal.push({ formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` });
    }
    const subtotalRow = sheet.addRow(subtotal);
    subtotalRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.border = { top: { style: "thin" } };
    });
  }
}

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

// GET /api/wfm/summary/export?month=YYYY-MM — the CA-facing Excel export
// (spec §5.6, "THE deliverable"). Placeholder layout (two sheets:
// Full-Time / Contractors) until the client's actual CA format sample
// arrives -- see summaryExportTemplate.ts for the swappable column config.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;

  const month = request.nextUrl.searchParams.get("month");
  if (!month || !MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month (YYYY-MM) is required" }, { status: 400 });
  }

  // Mirrors GET /api/wfm/summary exactly: the workbook a supervisor downloads
  // must never contain a site they don't supervise.
  const scope = await resolveWfmScope(ctx);
  const admin = createAdminSupabase();
  const [summaries, config, { data: tenantRow }] = await Promise.all([
    getMonthlySummary(tenantId, month, scope.unrestricted ? undefined : (scope.employeeIds ?? [])),
    getWfmConfig(admin, tenantId),
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  const tenantName = (tenantRow?.name as string | undefined) ?? "";
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BPMSquare";
  workbook.created = new Date(`${month}-01T00:00:00Z`);

  // One sheet per CONFIGURED employment type, not the old hardcoded
  // Full-Time/Contractors pair -- a tenant that adds e.g. "Intern" gets its
  // own sheet instead of those people silently landing in someone else's
  // section. A trailing "Other" sheet catches rows whose stored type is no
  // longer in the configured list (a type renamed/removed after use), so
  // nobody can fall off the payroll export entirely.
  // Payroll-desk sheets first, so the workbook opens on the view the
  // accountant actually uses. The per-type sheets and Daily Detail below are
  // unchanged and remain the complete record.
  const payrollRows = [...summaries].sort((a, b) =>
    (a.employee_code ?? "").localeCompare(b.employee_code ?? "") || a.full_name.localeCompare(b.full_name)
  );
  writePayrollSummary(workbook.addWorksheet("Summary"), month, tenantName, payrollRows);
  writePayrollReport(
    workbook.addWorksheet("Payroll Report"),
    month, tenantName, payrollRows, config.deduct_breaks, config.timezone
  );

  const configuredCodes = new Set(config.employment_types.map((t) => t.code));
  for (const type of config.employment_types) {
    const rows = summaries.filter((s) => s.employment_type === type.code);
    // Excel sheet names: 31 chars max, and : \ / ? * [ ] are illegal.
    const sheetName = type.label.replace(/[:\\/?*[\]]/g, "-").slice(0, 31) || type.code.slice(0, 31);
    writeSection(workbook.addWorksheet(sheetName), `Attendance Summary — ${month} — ${type.label}`, rows);
  }
  const unclassified = summaries.filter((s) => !configuredCodes.has(s.employment_type));
  if (unclassified.length > 0) {
    writeSection(workbook.addWorksheet("Other"), `Attendance Summary — ${month} — Other`, unclassified);
  }
  writeDailyDetail(
    workbook.addWorksheet("Daily Detail"),
    `Daily Attendance Detail — ${month}`,
    summaries,
    config.deduct_breaks,
    config.timezone
  );

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="wfm-summary-${month}.xlsx"`,
    },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { getMonthlySummary, type EmployeeMonthSummary } from "@/lib/wfm/monthlySummary";
import { MONTHLY_SUMMARY_COLUMNS, DAILY_DETAIL_COLUMNS } from "@/lib/wfm/summaryExportTemplate";

const MONTH_RE = /^\d{4}-\d{2}$/;
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF152233" } };

function writeSection(sheet: ExcelJS.Worksheet, title: string, rows: EmployeeMonthSummary[]) {
  // Width only, never `header` -- assigning a header here makes ExcelJS
  // auto-insert its own header row, which duplicated the explicit one added
  // below (the stray first row in every export until this fix).
  sheet.columns = MONTHLY_SUMMARY_COLUMNS.map((c) => ({ width: c.width }));

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

  const [summaries, config] = await Promise.all([
    getMonthlySummary(tenantId, month),
    getWfmConfig(createAdminSupabase(), tenantId),
  ]);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BPMSquare";
  workbook.created = new Date(`${month}-01T00:00:00Z`);

  // One sheet per CONFIGURED employment type, not the old hardcoded
  // Full-Time/Contractors pair -- a tenant that adds e.g. "Intern" gets its
  // own sheet instead of those people silently landing in someone else's
  // section. A trailing "Other" sheet catches rows whose stored type is no
  // longer in the configured list (a type renamed/removed after use), so
  // nobody can fall off the payroll export entirely.
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

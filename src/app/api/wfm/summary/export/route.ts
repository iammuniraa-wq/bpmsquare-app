import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { getMonthlySummary, type EmployeeMonthSummary } from "@/lib/wfm/monthlySummary";
import { MONTHLY_SUMMARY_COLUMNS } from "@/lib/wfm/summaryExportTemplate";

const MONTH_RE = /^\d{4}-\d{2}$/;
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF152233" } };

function writeSection(sheet: ExcelJS.Worksheet, title: string, rows: EmployeeMonthSummary[]) {
  sheet.columns = MONTHLY_SUMMARY_COLUMNS.map((c) => ({ header: c.header, width: c.width }));

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

  const summaries = await getMonthlySummary(tenantId, month);
  const fullTime = summaries.filter((s) => s.employment_type === "full_time");
  const contractors = summaries.filter((s) => s.employment_type === "contractor");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BPMSquare";
  workbook.created = new Date(`${month}-01T00:00:00Z`);

  writeSection(workbook.addWorksheet("Full-Time"), `Attendance Summary — ${month} — Full-Time`, fullTime);
  writeSection(workbook.addWorksheet("Contractors"), `Attendance Summary — ${month} — Contractors`, contractors);

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="wfm-summary-${month}.xlsx"`,
    },
  });
}

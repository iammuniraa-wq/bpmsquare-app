import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getMonthlySummary, getSummaryForRange, MAX_RANGE_DAYS } from "@/lib/wfm/monthlySummary";
import { buildSummaryWorkbook } from "@/lib/wfm/summaryWorkbook";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-\d{2}$/;
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/wfm/summary/export?month=YYYY-MM (a calendar month) OR
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (a custom range, owner decision 2026-09-09
// -- capped at MAX_RANGE_DAYS, full fidelity: every sheet below, same as the
// month path). The CA-facing Excel export (spec §5.6, "THE deliverable").
// Placeholder layout (two sheets: Full-Time / Contractors) until the
// client's actual CA format sample arrives -- see summaryExportTemplate.ts
// for the swappable column config.
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
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const isRange = !!(from || to);

  if (isRange && (!from || !DATE_RE.test(from) || !to || !DATE_RE.test(to))) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) are both required for a custom range" }, { status: 400 });
  }
  if (!isRange && (!month || !MONTH_RE.test(month))) {
    return NextResponse.json({ error: "month (YYYY-MM), or from/to (YYYY-MM-DD), is required" }, { status: 400 });
  }

  // Mirrors GET /api/wfm/summary exactly: the workbook a supervisor downloads
  // must never contain a site they don't supervise.
  const scope = await resolveWfmScope(ctx);
  const employeeIds = scope.unrestricted ? undefined : (scope.employeeIds ?? []);
  const admin = createAdminSupabase();

  const [summaries, config, { data: tenantRow }] = await Promise.all([
    isRange ? getSummaryForRange(tenantId, from!, to!, employeeIds) : getMonthlySummary(tenantId, month!, employeeIds),
    getWfmConfig(admin, tenantId),
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
  ]);
  if (summaries === null) {
    return NextResponse.json({ error: `to must be on or after from, and the range can't exceed ${MAX_RANGE_DAYS} days` }, { status: 400 });
  }
  const tenantName = (tenantRow?.name as string | undefined) ?? "";
  const label = isRange ? `${shortDate(from!)} – ${shortDate(to!)}` : monthLabel(month!);
  const fileTag = isRange ? `${from}_to_${to}` : month!;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BPMSquare";
  workbook.created = new Date(`${isRange ? from : `${month}-01`}T00:00:00Z`);

  // Sheet layout lives in buildSummaryWorkbook: one sheet per configured employment type, or, when the workspace
  // switches on payroll_by_location, one per location and type. Payroll-desk sheets first, so the workbook opens
  // on the view the accountant actually uses; Daily Detail last as the complete record.
  buildSummaryWorkbook(workbook, { summaries, config, label, tenantName });

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="wfm-summary-${fileTag}.xlsx"`,
    },
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getMonthlySummary, getSummaryForRange, MAX_RANGE_DAYS } from "@/lib/wfm/monthlySummary";

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/wfm/summary?month=YYYY-MM (a calendar month) OR
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (a custom range, owner decision 2026-09-09
// -- capped at MAX_RANGE_DAYS). Every active employee (or the caller's
// subtree). Site/employment-type filtering happens client-side against this
// same payload (the dataset is small -- a few hundred rows at most for the
// ~100-employee scale this module targets).
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

  // The month/range view is scoped to the caller's subtree, so a site
  // supervisor's export contains their own site only -- previously every
  // supervisor received every employee's hours and filtered them in the browser.
  const scope = await resolveWfmScope(ctx);
  const employeeIds = scope.unrestricted ? undefined : (scope.employeeIds ?? []);
  const config = await getWfmConfig(createAdminSupabase(), tenantId);

  if (from || to) {
    if (!from || !DATE_RE.test(from) || !to || !DATE_RE.test(to)) {
      return NextResponse.json({ error: "from and to (YYYY-MM-DD) are both required for a custom range" }, { status: 400 });
    }
    const summaries = await getSummaryForRange(tenantId, from, to, employeeIds);
    if (!summaries) {
      return NextResponse.json({ error: `to must be on or after from, and the range can't exceed ${MAX_RANGE_DAYS} days` }, { status: 400 });
    }
    return NextResponse.json({
      range: { from, to },
      employees: summaries,
      deduct_breaks: config.deduct_breaks,
      timezone: config.timezone,
    });
  }

  if (!month || !MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month (YYYY-MM), or from/to (YYYY-MM-DD), is required" }, { status: 400 });
  }
  const summaries = await getMonthlySummary(tenantId, month, employeeIds);
  return NextResponse.json({
    month,
    employees: summaries,
    deduct_breaks: config.deduct_breaks,
    timezone: config.timezone,
  });
}

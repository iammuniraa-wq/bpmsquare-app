import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getMonthlySummary } from "@/lib/wfm/monthlySummary";

const MONTH_RE = /^\d{4}-\d{2}$/;

// GET /api/wfm/summary?month=YYYY-MM — the monthly CA summary (spec §5.6),
// every active employee. Site/employment-type filtering happens client-side
// against this same payload (the dataset is small -- a few hundred rows at
// most for the ~100-employee scale this module targets).
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

  // The month view is scoped to the caller's subtree, so a site supervisor's
  // export contains their own site only -- previously every supervisor
  // received every employee's hours and filtered them in the browser.
  const scope = await resolveWfmScope(ctx);
  const [summaries, config] = await Promise.all([
    getMonthlySummary(tenantId, month, scope.unrestricted ? undefined : (scope.employeeIds ?? [])),
    getWfmConfig(createAdminSupabase(), tenantId),
  ]);
  return NextResponse.json({
    month,
    employees: summaries,
    deduct_breaks: config.deduct_breaks,
    timezone: config.timezone,
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmEmployee, getWfmConfig } from "@/lib/wfm/server";
import { getMonthlySummary, getLeaveBalance } from "@/lib/wfm/monthlySummary";

const MONTH_RE = /^\d{4}-\d{2}$/;

// GET /api/wfm/me/timesheet?month=YYYY-MM — the calling employee's own
// month view: day list + monthly totals + annual leave balance. Defaults
// to the current month (tenant timezone) when ?month is omitted.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, employee } = ctx;

  const requested = request.nextUrl.searchParams.get("month");
  let month = requested;
  if (!month) {
    const admin = createAdminSupabase();
    const config = await getWfmConfig(admin, tenantId);
    month = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit" })
      .format(new Date()).slice(0, 7);
  }
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const [summaries, leaveBalance] = await Promise.all([
    getMonthlySummary(tenantId, month, [employee.id]),
    getLeaveBalance(tenantId, employee.id, Number(month.slice(0, 4))),
  ]);

  if (summaries.length === 0) {
    return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
  }

  return NextResponse.json({ month, summary: summaries[0], leave_balance: leaveBalance });
}

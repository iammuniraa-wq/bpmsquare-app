import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmEmployee, getWfmConfig } from "@/lib/wfm/server";
import { getMonthlySummary } from "@/lib/wfm/monthlySummary";

const MONTH_RE = /^\d{4}-\d{2}$/;
const TREND_MONTHS = 6;

/** The N months ending at `yearMonth`, oldest first. */
function trailingMonths(yearMonth: string, count: number): string[] {
  const [y, m] = yearMonth.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

// GET /api/wfm/me/analytics?month=YYYY-MM — how the calling employee has
// performed: a 6-month trend of their own hours/attendance/punctuality,
// plus (for supervisors only) the same month's team-wide averages to
// compare against. A plain employee never receives any co-worker's data --
// only their own series and, deliberately, nothing else.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, employee, isSupervisor } = ctx;

  const admin = createAdminSupabase();
  const requested = request.nextUrl.searchParams.get("month");
  let month = requested;
  if (!month) {
    const config = await getWfmConfig(admin, tenantId);
    month = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit" })
      .format(new Date()).slice(0, 7);
  }
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const months = trailingMonths(month, TREND_MONTHS);
  const monthlyOwn = await Promise.all(
    months.map((m) => getMonthlySummary(tenantId, m, [employee.id]))
  );

  const trend = months.map((m, i) => {
    const summary = monthlyOwn[i][0];
    const t = summary?.totals;
    return {
      month: m,
      working_minutes: t?.working_minutes ?? 0,
      days_present: t?.days_present ?? 0,
      late_marks: t?.late_marks ?? 0,
      paid_leave_days: t?.paid_leave_days ?? 0,
      unpaid_leave_days: t?.unpaid_leave_days ?? 0,
      incomplete_days: t?.incomplete_days ?? 0,
    };
  });

  const current = trend[trend.length - 1];
  const previous = trend.length > 1 ? trend[trend.length - 2] : null;

  // Punctuality: share of days actually attended that weren't a late mark.
  const onTimeRate = current.days_present > 0
    ? Math.round(((current.days_present - current.late_marks) / current.days_present) * 100)
    : null;

  let team = null;
  if (isSupervisor) {
    const all = await getMonthlySummary(tenantId, month);
    if (all.length > 0) {
      const avg = (pick: (t: (typeof all)[number]["totals"]) => number) =>
        Math.round(all.reduce((s, e) => s + pick(e.totals), 0) / all.length);
      team = {
        employee_count: all.length,
        avg_working_minutes: avg((t) => t.working_minutes),
        avg_days_present: avg((t) => t.days_present),
        avg_late_marks: avg((t) => t.late_marks),
        total_incomplete_days: all.reduce((s, e) => s + e.totals.incomplete_days, 0),
      };
    }
  }

  return NextResponse.json({
    month,
    is_supervisor: isSupervisor,
    trend,
    current,
    previous,
    on_time_rate: onTimeRate,
    team,
  });
}

import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmEmployee, getWfmConfig } from "@/lib/wfm/server";
import { getMonthlySummary, getLeaveBalanceDetail } from "@/lib/wfm/monthlySummary";
import { dateKeyInTz } from "@/lib/wfm/server";
import { customRuleCount, rulesFor } from "@/lib/wfm/typeRules";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

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

  const config = await getWfmConfig(createAdminSupabase(), tenantId);

  const requested = request.nextUrl.searchParams.get("month");
  const month = requested
    ?? new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit" })
      .format(new Date()).slice(0, 7);
  if (!MONTH_RE.test(month)) {
    return NextResponse.json({ error: "month must be YYYY-MM" }, { status: 400 });
  }

  const [summaries, leaveDetail] = await Promise.all([
    getMonthlySummary(tenantId, month, [employee.id]),
    getLeaveBalanceDetail(tenantId, employee.id, month),
  ]);

  if (summaries.length === 0) {
    return NextResponse.json({ error: "Employee record not found" }, { status: 404 });
  }

  // deduct_breaks tells the UI which figure IS "total worked" for this
  // tenant (net vs gross) -- the same switch getMonthlySummary already
  // applies to the monthly total, surfaced so the daily rows agree with it.
  return NextResponse.json({
    month,
    summary: summaries[0],
    leave_balance: leaveDetail.rows,
    // Rules by employment type, so the screen can say what is different for this person. null = nothing differs.
    leave_not_offered: leaveDetail.notOffered.map((t) => t.name),
    employment_type_label: leaveDetail.employmentTypeLabel,
    week_off: (() => {
      const r = rulesFor(employee.employment_type, config, dateKeyInTz(new Date(), config.timezone));
      return r.source.week_off_days === "type" ? r.week_off_days : null;
    })(),
    type_rules_active: (() => {
      const entry = employee.employment_type ? config.type_rules[employee.employment_type] : undefined;
      return customRuleCount(entry) > 0 && (!entry?.effective_from || entry.effective_from <= dateKeyInTz(new Date(), config.timezone));
    })(),
    deduct_breaks: config.deduct_breaks,
    timezone: config.timezone,
  });
}

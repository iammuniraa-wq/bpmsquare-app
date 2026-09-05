import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkMonthlyLimit, monthLabel, type LeaveSpan } from "./leaveRules";
import { LEAVE_TYPE_NEW_COLUMNS_RE } from "./leaveTypeInput";

// Server-side half of the leave type rules (0109, 0112): load a type with
// its limits (tolerating a database where the migrations are pending), and
// say whether a new span would break the month's cap for this employee.

export type LeaveTypeRow = {
  id: string; name: string; category: string; active: boolean;
  monthly_limit: number | null; paid_days_per_month: number | null;
  quota_period: "year" | "month";
};

export async function loadLeaveType(admin: SupabaseClient, tenantId: string, id: string, activeOnly = false): Promise<LeaveTypeRow | null> {
  let q = admin.from("wfm_leave_types").select("id, name, category, active, monthly_limit, paid_days_per_month, quota_period").eq("id", id).eq("tenant_id", tenantId);
  if (activeOnly) q = q.eq("active", true);
  let res = await q.maybeSingle();
  if (res.error && LEAVE_TYPE_NEW_COLUMNS_RE.test(res.error.message)) {
    let q2 = admin.from("wfm_leave_types").select("id, name, category, active").eq("id", id).eq("tenant_id", tenantId);
    if (activeOnly) q2 = q2.eq("active", true);
    res = (await q2.maybeSingle()) as typeof res;
  }
  if (res.error || !res.data) return null;
  const d = res.data as Partial<LeaveTypeRow> & { id: string; name: string; category: string; active: boolean };
  return { ...d, monthly_limit: d.monthly_limit ?? null, paid_days_per_month: d.paid_days_per_month ?? null, quota_period: d.quota_period ?? "year" };
}

/** The employee's quota for a type: their own override, else the tenant default. */
export async function quotaFor(admin: SupabaseClient, tenantId: string, employeeId: string, leaveTypeId: string): Promise<number> {
  const { data } = await admin.from("wfm_leave_quotas").select("employee_id, annual_quota")
    .eq("tenant_id", tenantId).eq("leave_type_id", leaveTypeId)
    .or(`employee_id.eq.${employeeId},employee_id.is.null`);
  const rows = (data ?? []) as { employee_id: string | null; annual_quota: number }[];
  const override = rows.find((r) => r.employee_id === employeeId);
  const fallback = rows.find((r) => r.employee_id === null);
  return Number(override?.annual_quota ?? fallback?.annual_quota ?? 0);
}

/** The cap that binds a month: an explicit monthly limit, else -- for a
 *  type whose quota is per month -- the quota itself. */
export async function effectiveMonthlyCap(admin: SupabaseClient, tenantId: string, employeeId: string, type: LeaveTypeRow): Promise<number | null> {
  if (type.monthly_limit) return type.monthly_limit;
  if (type.quota_period === "month") return await quotaFor(admin, tenantId, employeeId, type.id);
  return null;
}

/** null when fine; otherwise the message to show the person. */
export async function monthlyLimitError(
  admin: SupabaseClient,
  tenantId: string,
  employeeId: string,
  type: LeaveTypeRow,
  span: LeaveSpan
): Promise<string | null> {
  const cap = await effectiveMonthlyCap(admin, tenantId, employeeId, type);
  if (cap === null) return null;
  if (cap <= 0) return `${type.name} has no days available this month.`;
  // Everything of this type that touches the months the span covers:
  // approved records and requests still waiting for a decision.
  const months = Object.keys(spanMonths(span));
  const from = `${months[0]}-01`;
  const lastMonth = months[months.length - 1];
  const to = new Date(Date.UTC(Number(lastMonth.slice(0, 4)), Number(lastMonth.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const [{ data: records }, { data: pending }] = await Promise.all([
    admin.from("wfm_leave_records").select("date_from, date_to, half_day")
      .eq("tenant_id", tenantId).eq("employee_id", employeeId).eq("leave_type_id", type.id)
      .lte("date_from", to).gte("date_to", from),
    admin.from("wfm_leave_requests").select("date_from, date_to, half_day")
      .eq("tenant_id", tenantId).eq("employee_id", employeeId).eq("leave_type_id", type.id).eq("status", "pending")
      .lte("date_from", to).gte("date_to", from),
  ]);
  const existing = [...(records ?? []), ...(pending ?? [])] as LeaveSpan[];
  const v = checkMonthlyLimit(cap, span, existing);
  if (!v) return null;
  const already = v.already > 0 ? ` — ${v.already} already taken or pending in ${monthLabel(v.month)}` : "";
  return `${type.name} is limited to ${v.limit} day${v.limit === 1 ? "" : "s"} a month${already}.`;
}

function spanMonths(span: LeaveSpan): Record<string, true> {
  const out: Record<string, true> = {};
  const d = new Date(span.date_from + "T00:00:00Z");
  const end = new Date(span.date_to + "T00:00:00Z");
  while (d <= end) {
    out[d.toISOString().slice(0, 7)] = true;
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
  }
  return out;
}

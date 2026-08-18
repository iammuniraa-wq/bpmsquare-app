import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase-server";
import { getWfmConfig } from "@/lib/wfm/server";
import { getMonthlySummary, getLeaveBalance } from "@/lib/wfm/monthlySummary";

const MONTH_RE = /^\d{4}-\d{2}$/;

/**
 * The Employee Hub's core profile payload — identity, shift/site, reporting
 * line, this month's attendance totals and leave balance. Extracted from
 * GET /api/wfm/employees/[id] so the hub PAGE can server-render it and hand it
 * to EmployeeHubClient as a prop: without it the hub painted a blank
 * "Loading…" through one full Seoul round-trip on every open, because the
 * identity header and stat tiles all wait on this fetch. The API route stays
 * the refresh path (month change, after a mutation).
 *
 * Returns null when the employee doesn't exist in this tenant.
 */
export async function buildEmployeeHubProfile(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  month?: string | null
) {
  const { data: employee } = await supabase
    .from("employees")
    .select(
      `id, employee_code, first_name, last_name, phone, status, employment_type, wfm_role,
       supervisor_id, consent_recorded_at,
       wfm_shifts(id, name, start_time, end_time, is_night_shift), wfm_sites!site_id(id, name)`
    )
    .eq("id", employeeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!employee) return null;

  const admin = createAdminSupabase();
  const config = await getWfmConfig(admin, tenantId);
  const yearMonth = month && MONTH_RE.test(month)
    ? month
    : new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

  const [{ data: reports }, { data: supervisor }, { data: membership }, [summary], leaveBalance, { data: customRow }] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name").eq("tenant_id", tenantId).eq("supervisor_id", employeeId),
    employee.supervisor_id
      ? supabase.from("employees").select("id, first_name, last_name").eq("tenant_id", tenantId).eq("id", employee.supervisor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("tenant_users").select("id").eq("tenant_id", tenantId).eq("employee_id", employeeId).maybeSingle(),
    getMonthlySummary(tenantId, yearMonth, [employeeId]),
    getLeaveBalance(tenantId, employeeId, Number(yearMonth.slice(0, 4))),
    // Fetched separately and best-effort: custom_data arrives via a manual
    // migration (0086), and code deploys before SQL runs in this product —
    // a missing column must degrade to "no custom fields", never break the
    // whole hub profile.
    supabase.from("employees").select("custom_data").eq("tenant_id", tenantId).eq("id", employeeId).maybeSingle(),
  ]);

  return {
    ...employee,
    custom_data: (customRow as { custom_data?: Record<string, unknown> | null } | null)?.custom_data ?? null,
    supervisor: supervisor ?? null,
    has_login: !!membership,
    reports: reports ?? [],
    month: yearMonth,
    month_summary: summary ?? null,
    leave_balance: leaveBalance,
  };
}

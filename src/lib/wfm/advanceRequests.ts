import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";

/**
 * Is `dateKey` (YYYY-MM-DD, the employee's shift-day) covered by an APPROVED
 * WFH advance request? The only caller-facing question mobile_work_start
 * actually needs answered -- shared between the punch route (the real gate)
 * and buildWfmMeState (so the punch dropdown never even offers an option the
 * route would reject).
 */
export async function isWfhApprovedForDate(
  admin: ReturnType<typeof createAdminSupabase>,
  tenantId: string,
  employeeId: string,
  dateKey: string
): Promise<boolean> {
  const { count } = await admin
    .from("wfm_advance_requests")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .eq("kind", "wfh")
    .eq("status", "approved")
    .lte("date_from", dateKey)
    .gte("date_to", dateKey);
  return (count ?? 0) > 0;
}

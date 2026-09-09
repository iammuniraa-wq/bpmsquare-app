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
  const { count, error } = await admin
    .from("wfm_advance_requests")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .eq("kind", "wfh")
    .eq("status", "approved")
    .lte("date_from", dateKey)
    .gte("date_to", dateKey);

  // 42P01/42703 = migration 0123 hasn't been applied to this database yet.
  // The table IS the WFH approval feature; before it existed, mobile_work_start
  // was punch-first with no gate at all. So "pending migration" must mean "no
  // gate" (bpmsquarecore.md §3b), NOT "denied" -- failing closed here would
  // take WFH punching away from every employee the moment this code deploys
  // ahead of the SQL, which is a worse outage than the feature simply being
  // absent. Any OTHER error still denies: that is a real failure to verify,
  // and an unverified approval shouldn't open the gate.
  if (error) return error.code === "42P01" || error.code === "42703";

  return (count ?? 0) > 0;
}

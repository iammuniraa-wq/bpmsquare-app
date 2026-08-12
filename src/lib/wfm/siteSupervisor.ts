import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";

type Admin = ReturnType<typeof createAdminSupabase>;

/**
 * Validate a client-supplied `supervisor_id` for a site and make the chosen
 * person an actual WFM supervisor.
 *
 * The promotion is deliberate, not a side effect that slipped in: naming
 * someone as a site's supervisor IS the act of making them one, and requiring
 * an admin to also remember a separate "set wfm_role = supervisor" step on the
 * Employees screen is exactly the kind of two-place configuration that leaves
 * a site silently unsupervised. Both site write paths are already tenant-admin
 * only, so this grants nothing an admin couldn't grant directly.
 *
 * Returns the verified id (or null to clear), or an error string for a 400.
 */
export async function verifySiteSupervisor(
  admin: Admin,
  tenantId: string,
  supervisorId: unknown
): Promise<{ id: string | null } | { error: string }> {
  if (supervisorId === null || supervisorId === "") return { id: null };
  if (typeof supervisorId !== "string") return { error: "supervisor_id must be an employee id or null" };

  // Tenant-verified before use, per MULTI_TENANT_GUARDRAILS.md -- this id
  // comes straight from a request body.
  const { data: employee } = await admin
    .from("employees")
    .select("id, wfm_role, status")
    .eq("id", supervisorId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!employee) return { error: "Unknown employee" };
  if (employee.status !== "active") {
    return { error: "That employee is inactive — pick someone active as the site supervisor" };
  }

  if (employee.wfm_role !== "supervisor") {
    const { error } = await admin
      .from("employees")
      .update({ wfm_role: "supervisor" })
      .eq("id", employee.id)
      .eq("tenant_id", tenantId);
    if (error) return { error: "Could not grant supervisor access to that employee" };
  }

  return { id: employee.id };
}

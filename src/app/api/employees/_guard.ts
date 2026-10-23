import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";

/** Admin of a tenant that has Business Roles: the gate every employee mutation (and the delete-impact read) shares. */
export async function employeesAdminGuard() {
  const { supabase, tenantId, role } = await requireTenantUser();
  if (role !== "admin") throw { status: 403, message: "Forbidden" };
  if (!(await tenantHasFeature(supabase, tenantId, "business_roles"))) {
    throw { status: 403, message: "Business Roles isn't enabled for your workspace" };
  }
  return { supabase, tenantId };
}

import "server-only";
import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import { getWfmConfig } from "@/lib/wfm/server";

/**
 * Every Workforce settings page: admin only, and only on a workspace that has
 * the Workforce module. Returns the config with defaults filled in group by
 * group (costing, notifications, ...), so a tenant row written before a group
 * existed never renders a blank form.
 */
export async function loadWorkforceSettings() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features, config").eq("id", tenantId!).single();
  if (!data?.features?.wfm) redirect(ROUTES.settings);

  const config = await getWfmConfig(admin, tenantId!);
  const projectsOn = data.features?.wfm_projects === true && data.features?.invoices === true;
  return { config, projectsOn };
}

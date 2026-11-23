import "server-only";
import type { TenantFeatures } from "@/lib/constants";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getUserRole } from "@/lib/tenant";
import type { ProjectFinanceAnalytics } from "./portfolio";
import { getPortfolioFinance, resolveFinanceAccess } from "./server";

/**
 * AnalyticsData.projectFinance: the portfolio for the person looking at the dashboard or Reports. Read only for a workspace that owns the
 * module, and only the projects THIS person may see cost and margin for (the access check is made in the loader, where the data is made).
 * A failure leaves the dashboard standing and the blocks saying the data is not available.
 */
export async function projectFinanceForAnalytics(args: { tenantId: string; features: Partial<TenantFeatures> | null | undefined; config: unknown; includeClosed?: boolean }): Promise<ProjectFinanceAnalytics> {
  if (args.features?.project_dashboards !== true || args.features?.contract_projects !== true) return null;
  try {
    const user = await getAuthUser();
    const role = await getUserRole();
    if (!user || !role) return null;
    const admin = createAdminSupabase();
    const access = await resolveFinanceAccess({ supabase: admin, tenantId: args.tenantId, userId: user.id, role, features: args.features, config: args.config });
    return await getPortfolioFinance({ admin, tenantId: args.tenantId, userId: user.id, access, features: args.features, includeClosed: args.includeClosed });
  } catch (e) {
    console.error("[analytics] project finance could not be read", e);
    return null;
  }
}

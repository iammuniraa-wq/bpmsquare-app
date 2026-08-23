import { getDashboardSummary, getAnalyticsData } from "@/lib/data";
import { getTenant, getUserRole } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { mergeDashLayouts } from "@/lib/dashboardLayout";
import type { DashLayoutItem } from "@/lib/constants";
import DashboardLayout from "@/components/DashboardLayout";
import NovaStream from "@/components/NovaStream";
import { getNovaStreamItems, getNovaRecentWins } from "@/lib/nova/stream";
import { isNovaTenant } from "@/lib/nova/isNovaTenant";
import type { TenantFeatures } from "@/lib/constants";

function greetingForHour(hour: number): string {
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

export default async function DashboardPage() {
  const [tenant, role] = await Promise.all([getTenant(), getUserRole()]);
  const { supabase, tenantId, userId } = await requireTenantUser();

  // Nova tenants get the Stream home screen instead of the classic KPI
  // dashboard -- still needs the same summary aggregate (kpis, overdue
  // invoices) for its own stat strip, so this is no longer a skip, just a
  // different presentation of the same real numbers.
  if (isNovaTenant(tenant)) {
    const [{ data: membership }, { kpis, overdueInvoices }, recentWins] = await Promise.all([
      supabase.from("tenant_users").select("display_name, employee_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
      getDashboardSummary(),
      getNovaRecentWins(tenantId),
    ]);
    let firstName = (membership?.display_name ?? "").trim().split(/\s+/)[0] || null;
    if (!firstName && membership?.employee_id) {
      const { data: emp } = await supabase
        .from("employees").select("first_name").eq("id", membership.employee_id).eq("tenant_id", tenantId).maybeSingle();
      firstName = emp?.first_name?.trim() || null;
    }

    const items = await getNovaStreamItems(tenantId);
    const now = new Date();
    const overdueTotal = overdueInvoices.reduce((t, inv) => t + Math.max(0, inv.total - inv.paid_amount), 0);
    return (
      <NovaStream
        items={items}
        wins={recentWins}
        userName={firstName}
        greeting={greetingForHour(now.getHours())}
        dateLabel={now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        kpis={{
          openPipeline: kpis.openQuoteValue,
          openCases: kpis.openCases,
          activeContracts: kpis.activeContracts,
          overdueCount: overdueInvoices.length,
          overdueTotal,
        }}
        features={(tenant?.features ?? {}) as TenantFeatures}
      />
    );
  }

  const [{ kpis, attention, readyCases, workOrderRows, recentActivity, overdueInvoices }, analytics] =
    await Promise.all([getDashboardSummary(), getAnalyticsData()]);
  const tenantDefault: DashLayoutItem[] = tenant?.config?.dashboard_layout ?? [];

  // A scoped member (>=1 Business Role assigned) sees the union of every
  // assigned role's own dashboard, where one is defined -- admins, and
  // members with zero roles assigned, are "unrestricted" everywhere else in
  // the app (see resolvePermissions()) and keep the tenant-wide default
  // here too. A role contributing nothing (dashboard_layout still null) is
  // fine -- rollout is role-by-role, not all-or-nothing.
  let effectiveLayout = tenantDefault;
  if (role !== "admin") {
    const { data: assignments } = await supabase
      .from("business_user_roles").select("role_id").eq("tenant_id", tenantId).eq("user_id", userId);
    const roleIds = (assignments ?? []).map((a) => a.role_id as string);
    if (roleIds.length > 0) {
      const { data: roleRows } = await supabase
        .from("business_roles").select("dashboard_layout").eq("tenant_id", tenantId).in("id", roleIds);
      const roleLayouts = (roleRows ?? [])
        .map((r) => r.dashboard_layout as DashLayoutItem[] | null)
        .filter((l): l is DashLayoutItem[] => Array.isArray(l) && l.length > 0);
      const merged = mergeDashLayouts(roleLayouts);
      if (merged.length > 0) effectiveLayout = merged;
    }
  }

  // A personal override -- the user's own tweaks on top of whichever
  // default (role-derived or tenant-wide) would otherwise apply -- always
  // wins outright when set. Self-service; see /api/dashboard/layout.
  const { data: membership } = await supabase
    .from("tenant_users").select("dashboard_layout_override, display_name, employee_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  const personalOverride = membership?.dashboard_layout_override as DashLayoutItem[] | null;
  if (Array.isArray(personalOverride) && personalOverride.length > 0) effectiveLayout = personalOverride;

  // First name for the greeting ("Good afternoon, Vani"): the membership's
  // display_name (set whenever a login is created from an employee), falling
  // back to the linked employee record for older memberships without one.
  let firstName = (membership?.display_name ?? "").trim().split(/\s+/)[0] || null;
  if (!firstName && membership?.employee_id) {
    const { data: emp } = await supabase
      .from("employees").select("first_name").eq("id", membership.employee_id).eq("tenant_id", tenantId).maybeSingle();
    firstName = emp?.first_name?.trim() || null;
  }

  return (
    <DashboardLayout
      kpis={kpis}
      attention={attention}
      readyCases={readyCases}
      workOrderRows={workOrderRows}
      recentActivity={recentActivity}
      overdueInvoices={overdueInvoices}
      analytics={analytics}
      features={tenant?.features ?? ({} as never)}
      dashLayout={effectiveLayout}
      isAdmin={role === "admin"}
      hasPersonalOverride={Array.isArray(personalOverride) && personalOverride.length > 0}
      userName={firstName}
    />
  );
}

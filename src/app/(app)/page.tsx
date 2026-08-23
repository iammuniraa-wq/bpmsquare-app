import { getDashboardSummary, getAnalyticsData } from "@/lib/data";
import { getTenant, getUserRole } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { mergeDashLayouts } from "@/lib/dashboardLayout";
import type { DashLayoutItem } from "@/lib/constants";
import DashboardLayout from "@/components/DashboardLayout";
import NovaStream from "@/components/NovaStream";
import { getNovaStreamItems } from "@/lib/nova/stream";

// Mirrors useIsNextgen3Layer() (src/lib/tenant-context.tsx) server-side --
// the client hook can't run here, so the same two-field check is repeated.
// Owner decision 2026-08-23: Nova tenants get the Stream home screen
// instead of the classic KPI dashboard; everyone else is unaffected.
function isNovaTenant(tenant: Awaited<ReturnType<typeof getTenant>>): boolean {
  return tenant?.config?.appearance?.ui_theme === "nextgen2" && tenant?.features?.next_experience === true;
}

function greetingForHour(hour: number): string {
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

export default async function DashboardPage() {
  const [tenant, role] = await Promise.all([getTenant(), getUserRole()]);
  const { supabase, tenantId, userId } = await requireTenantUser();

  // Nova tenants get the Stream home screen instead of the classic KPI
  // dashboard -- skip the (fairly expensive) summary/analytics aggregates
  // entirely rather than fetching data this screen never renders.
  if (isNovaTenant(tenant)) {
    const { data: membership } = await supabase
      .from("tenant_users").select("display_name, employee_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
    let firstName = (membership?.display_name ?? "").trim().split(/\s+/)[0] || null;
    if (!firstName && membership?.employee_id) {
      const { data: emp } = await supabase
        .from("employees").select("first_name").eq("id", membership.employee_id).eq("tenant_id", tenantId).maybeSingle();
      firstName = emp?.first_name?.trim() || null;
    }

    const items = await getNovaStreamItems(tenantId);
    const now = new Date();
    return (
      <NovaStream
        items={items}
        userName={firstName}
        greeting={greetingForHour(now.getHours())}
        dateLabel={now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
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

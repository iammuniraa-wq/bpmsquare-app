import { getDashboardSummary, getAnalyticsData } from "@/lib/data";
import { getTenant, getUserRole } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { mergeDashLayouts } from "@/lib/dashboardLayout";
import type { DashLayoutItem } from "@/lib/constants";
import DashboardLayout from "@/components/DashboardLayout";
import NovaStream from "@/components/NovaStream";
import { getNovaRecentWins } from "@/lib/nova/stream";
import { getNovaRankings } from "@/lib/nova/rankings";
import { isNovaTenant } from "@/lib/nova/isNovaTenant";
import { resolveNovaLayout } from "@/lib/nova/streamLayout";
import { isAnalyticsId } from "@/lib/analyticsMeta";
import type { TenantFeatures } from "@/lib/constants";

function greetingForHour(hour: number): string {
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

// A login created without a real name on file often has display_name
// defaulted to the account's email -- splitting an email on whitespace
// just returns the whole email back (no spaces to split on), which used
// to print as e.g. "Morning, sap.rashid@gmail.com." in the greeting.
// Treat anything with an "@" as not a usable name at all.
function firstNameFrom(displayName: string | null | undefined): string | null {
  const trimmed = (displayName ?? "").trim();
  if (!trimmed || trimmed.includes("@")) return null;
  return trimmed.split(/\s+/)[0] || null;
}

export default async function DashboardPage() {
  const [tenant, role] = await Promise.all([getTenant(), getUserRole()]);
  const { supabase, tenantId, userId } = await requireTenantUser();

  // Nova tenants get the Stream home screen instead of the classic KPI
  // dashboard -- still needs the same summary aggregate (kpis, overdue
  // invoices) for its own stat strip, so this is no longer a skip, just a
  // different presentation of the same real numbers.
  //
  // Wrapped: Nova is new and experimental, and its "Adapt" layout reuses
  // tenants.config.dashboard_layout -- a tenant that customized the CLASSIC
  // dashboard before Nova was ever turned on for them has classic block ids
  // sitting in that same field. Nothing here should be able to take the
  // whole page down; on any failure this falls through to the classic
  // dashboard below (still fully correct/safe for that tenant) and logs the
  // real error server-side instead of a redacted "Server Components render"
  // error reaching the browser.
  if (isNovaTenant(tenant)) {
    try {
      const features = (tenant?.features ?? {}) as TenantFeatures;
      const [{ data: membership }, { kpis, overdueInvoices }, recentWins] = await Promise.all([
        supabase.from("tenant_users").select("dashboard_layout_override, display_name, employee_id").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(),
        getDashboardSummary(),
        getNovaRecentWins(tenantId),
      ]);
      let firstName = firstNameFrom(membership?.display_name);
      if (!firstName && membership?.employee_id) {
        const { data: emp } = await supabase
          .from("employees").select("first_name").eq("id", membership.employee_id).eq("tenant_id", tenantId).maybeSingle();
        firstName = emp?.first_name?.trim() || null;
      }

      // Tenant-wide default + personal override, same DashLayoutItem[]
      // storage the classic dashboard uses (see lib/nova/streamLayout.ts for
      // why the Business-Role-derived layer is deliberately not replicated
      // here). Personal always wins outright when set, same as classic.
      // Array.isArray guards both -- a malformed/non-array value in either
      // column (e.g. carried over from before this shape existed) falls
      // back to the real default instead of crashing resolveNovaLayout.
      const personalOverrideRaw = membership?.dashboard_layout_override;
      const personalOverride = Array.isArray(personalOverrideRaw) ? (personalOverrideRaw as DashLayoutItem[]) : null;
      const tenantDefaultRaw = tenant?.config?.dashboard_layout;
      const tenantDefault: DashLayoutItem[] = Array.isArray(tenantDefaultRaw) ? tenantDefaultRaw : [];
      const savedLayout = personalOverride && personalOverride.length > 0 ? personalOverride : tenantDefault;
      const effectiveLayout = resolveNovaLayout(savedLayout, features);

      const needsAnalytics = effectiveLayout.some((b) => isAnalyticsId(b.id));
      const [rankings, analytics] = await Promise.all([
        getNovaRankings(tenantId, features),
        needsAnalytics ? getAnalyticsData() : Promise.resolve(null),
      ]);
      const now = new Date();
      const overdueTotal = overdueInvoices.reduce((t, inv) => t + Math.max(0, inv.total - inv.paid_amount), 0);
      return (
        <NovaStream
          rankings={rankings}
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
          features={features}
          analytics={analytics}
          dashLayout={effectiveLayout}
          isAdmin={role === "admin"}
          hasPersonalOverride={!!personalOverride && personalOverride.length > 0}
        />
      );
    } catch (e) {
      console.error("[NovaStream] failed to render, falling back to classic dashboard", e);
    }
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
  let firstName = firstNameFrom(membership?.display_name);
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

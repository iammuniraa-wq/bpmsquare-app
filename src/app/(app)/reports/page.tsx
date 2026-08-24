import { listQuotes, getAnalyticsData } from "@/lib/data";
import { getTenant, requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions, toViewableWorkcenters, requireWorkcenterView } from "@/lib/permissions";
import PageHeader from "@/components/PageHeader";
import { DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import ReportsClient from "./ReportsClient";
import ReportsTabs from "./ReportsTabs";

export default async function ReportsPage() {
  await requireWorkcenterView("reports");
  await requireFeature("reports");

  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const [rows, analytics, tenant, perms] = await Promise.all([
    listQuotes(),
    getAnalyticsData(),
    getTenant(),
    resolvePermissions(supabase, tenantId, userId, role),
  ]);
  // Business-Role visibility: a member granted only Workforce + Analytics sees
  // the WFM metrics, not the CRM/service ones. Admins (and members with no
  // Business Role) resolve to "all" and see everything, as before.
  const viewableWorkcenters = toViewableWorkcenters(perms);

  const quoteStatuses: QuoteStatusDef[] =
    (tenant?.config as { quote_statuses?: QuoteStatusDef[] })?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;
  return (
    <>
      <PageHeader title="Analytics" subtitle="Data · Reports · Export" />
      <ReportsTabs showTalk={tenant?.features?.ai_reports === true} />
      <ReportsClient
        rows={rows}
        analytics={analytics}
        features={tenant?.features ?? {} as never}
        hiddenMetrics={tenant?.config?.analytics_hidden ?? []}
        isAdmin={role === "admin"}
        quoteStatuses={quoteStatuses}
        viewableWorkcenters={viewableWorkcenters}
      />
    </>
  );
}

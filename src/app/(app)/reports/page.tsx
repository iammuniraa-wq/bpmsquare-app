import { listQuotes, getAnalyticsData } from "@/lib/data";
import { getTenant, getUserRole } from "@/lib/tenant";
import PageHeader from "@/components/PageHeader";
import { DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import { requireWorkcenterView } from "@/lib/permissions";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage() {
  await requireWorkcenterView("reports");
  const [rows, analytics, tenant, role] = await Promise.all([
    listQuotes(), getAnalyticsData(), getTenant(), getUserRole(),
  ]);
  const quoteStatuses: QuoteStatusDef[] =
    (tenant?.config as { quote_statuses?: QuoteStatusDef[] })?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;
  return (
    <>
      <PageHeader title="Analytics" subtitle="Data · Reports · Export" />
      <ReportsClient
        rows={rows}
        analytics={analytics}
        features={tenant?.features ?? {} as never}
        hiddenMetrics={tenant?.config?.analytics_hidden ?? []}
        isAdmin={role === "admin"}
        quoteStatuses={quoteStatuses}
      />
    </>
  );
}

import { listQuotes, getAnalyticsData } from "@/lib/data";
import { getTenant, getUserRole } from "@/lib/tenant";
import PageHeader from "@/components/PageHeader";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage() {
  const [rows, analytics, tenant, role] = await Promise.all([
    listQuotes(), getAnalyticsData(), getTenant(), getUserRole(),
  ]);
  return (
    <>
      <PageHeader title="Analytics" subtitle="Data · Reports · Export" />
      <ReportsClient
        rows={rows}
        analytics={analytics}
        features={tenant?.features ?? {} as never}
        hiddenMetrics={tenant?.config?.analytics_hidden ?? []}
        isAdmin={role === "admin"}
      />
    </>
  );
}

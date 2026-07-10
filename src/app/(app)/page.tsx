import { getDashboardSummary, getAnalyticsData } from "@/lib/data";
import { getTenant, getUserRole } from "@/lib/tenant";
import DashboardLayout from "@/components/DashboardLayout";

export default async function DashboardPage() {
  const [{ kpis, attention, readyCases, workOrderRows, recentActivity }, analytics, tenant, role] =
    await Promise.all([getDashboardSummary(), getAnalyticsData(), getTenant(), getUserRole()]);

  return (
    <DashboardLayout
      kpis={kpis}
      attention={attention}
      readyCases={readyCases}
      workOrderRows={workOrderRows}
      recentActivity={recentActivity}
      analytics={analytics}
      features={tenant?.features ?? ({} as never)}
      pinnedWidgets={tenant?.config?.dashboard_widgets ?? []}
      isAdmin={role === "admin"}
    />
  );
}

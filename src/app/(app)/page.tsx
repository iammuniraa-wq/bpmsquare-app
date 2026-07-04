import { getDashboardSummary } from "@/lib/data";
import DashboardLayout from "@/components/DashboardLayout";

export default async function DashboardPage() {
  const { kpis, attention, workOrderRows, recentActivity } = await getDashboardSummary();

  return (
    <DashboardLayout
      kpis={kpis}
      attention={attention}
      workOrderRows={workOrderRows}
      recentActivity={recentActivity}
    />
  );
}

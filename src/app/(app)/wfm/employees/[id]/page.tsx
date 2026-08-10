import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import { requireTenantUser } from "@/lib/supabase-server";
import TabTitle from "@/components/TabTitle";
import EmployeeHubClient from "./EmployeeHubClient";

export default async function WfmEmployeeHubPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();
  const { id } = await params;

  // Just the name, for the tab title -- EmployeeHubClient fetches the full
  // profile itself (same client-fetch pattern every other WFM page uses).
  const { supabase, tenantId } = await requireTenantUser();
  const { data: employee } = await supabase
    .from("employees")
    .select("first_name, last_name")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const tabTitle = employee ? [employee.first_name, employee.last_name].filter(Boolean).join(" ") : "Employee";

  return (
    <>
      <TabTitle title={tabTitle} />
      <EmployeeHubClient employeeId={id} />
    </>
  );
}

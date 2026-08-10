import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import TabTitle from "@/components/TabTitle";
import EmployeeHubClient from "./EmployeeHubClient";

export default async function WfmEmployeeHubPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();
  const { id } = await params;

  return (
    <>
      <TabTitle title="Workforce — Employee" />
      <EmployeeHubClient employeeId={id} />
    </>
  );
}

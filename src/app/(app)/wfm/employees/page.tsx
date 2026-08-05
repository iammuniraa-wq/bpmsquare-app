import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import WfmEmployeesClient from "./WfmEmployeesClient";

export default async function WfmEmployeesPage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");

  return (
    <>
      <TabTitle title="Workforce — Employees" />
      <PageHeader
        title="Employees"
        subtitle="Shift and site assignment, punch access and roles. Shares the Employees master data — HR fields live in Master data → Employees."
      />
      <WfmEmployeesClient />
    </>
  );
}

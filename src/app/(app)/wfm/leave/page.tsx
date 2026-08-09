import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import LeaveClient from "./LeaveClient";

export default async function WfmLeavePage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();

  return (
    <>
      <TabTitle title="Leave & Holidays" />
      <PageHeader
        title="Leave & Holidays"
        subtitle="Admin-entered leave records, leave types with default annual quotas, and the tenant holiday calendar."
      />
      <LeaveClient />
    </>
  );
}

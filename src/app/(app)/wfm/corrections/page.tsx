import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import CorrectionsQueueClient from "./CorrectionsQueueClient";

export default async function WfmCorrectionsQueuePage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();

  return (
    <>
      <TabTitle title="Corrections" />
      <PageHeader
        title="Corrections"
        subtitle="Employee-requested fixes to missing or wrong punches. Approving writes a new event and supersedes the original — nothing is ever edited in place."
      />
      <CorrectionsQueueClient />
    </>
  );
}

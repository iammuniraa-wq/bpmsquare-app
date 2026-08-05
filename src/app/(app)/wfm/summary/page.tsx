import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import SummaryClient from "./SummaryClient";

export default async function WfmSummaryPage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");

  return (
    <>
      <TabTitle title="Monthly Summary" />
      <PageHeader
        title="Monthly Summary"
        subtitle="Per-employee attendance for the CA — days present, hours, late marks, leave, holidays and night-shift allowance."
      />
      <SummaryClient />
    </>
  );
}

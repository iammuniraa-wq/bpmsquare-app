import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import MeClient from "./MeClient";

// The unified WFM home for any linked employee -- punch card, this month's
// hours, leave balance, next holiday, and recent corrections, all on one
// page inside the normal CRM shell. Replaces the old standalone /wfm-app
// as the primary experience; every WFM login (employee or supervisor)
// lands here.
export default async function WfmMePage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");

  return (
    <>
      <TabTitle title="My Workforce" />
      <PageHeader
        title="My Workforce"
        subtitle="Check in/out, this month's hours, leave balance, and your recent corrections."
      />
      <MeClient />
    </>
  );
}

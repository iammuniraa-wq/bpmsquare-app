import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import MeClient from "./MeClient";

// The unified WFM home for any linked employee -- a tile dashboard (Home,
// Time, Leave, Calendar, Analytics) inside the normal CRM shell, with
// check in/out happening straight from the Punch tile rather than on a
// dedicated screen. Replaces the old standalone /wfm-app as the primary
// experience; every WFM login (employee or supervisor) lands here.
export default async function WfmMePage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");

  return (
    <>
      <TabTitle title="My Workforce" />
      <PageHeader
        title="My Workforce"
        subtitle="Punch in and out, track your hours, request leave, and see how you're doing."
      />
      <MeClient />
    </>
  );
}

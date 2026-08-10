import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import RosterClient from "./RosterClient";

export default async function WfmRosterPage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();

  return (
    <>
      <TabTitle title="Workforce — Roster" />
      <PageHeader
        title="Roster"
        subtitle="Assign standing shifts to whole groups of employees at once, and apply temporary overrides — a different shift or a day off — to selected employees for specific dates."
      />
      <RosterClient />
    </>
  );
}

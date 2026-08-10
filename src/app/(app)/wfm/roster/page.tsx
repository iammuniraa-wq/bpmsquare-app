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
        subtitle="Assign a shift per employee per date. A date with no explicit assignment falls back to that employee's standing shift (set in Employees)."
      />
      <RosterClient />
    </>
  );
}

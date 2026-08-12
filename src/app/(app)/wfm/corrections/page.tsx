import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage, getWfmConfig } from "@/lib/wfm/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import CorrectionsPageTabs from "./CorrectionsPageTabs";

export default async function WfmCorrectionsQueuePage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();
  const { tenantId } = await requireTenantUser();
  const config = await getWfmConfig(createAdminSupabase(), tenantId);

  return (
    <>
      <TabTitle title="Corrections" />
      <PageHeader
        title="Corrections"
        subtitle="Employee-requested fixes to missing or wrong punches, and supervisor-flagged rechecks. Approving a correction writes a new event and supersedes the original — nothing is ever edited in place."
      />
      <CorrectionsPageTabs otEnabled={config.punch_types.ot} />
    </>
  );
}

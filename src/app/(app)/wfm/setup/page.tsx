import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import WfmSetupClient from "./WfmSetupClient";

export default async function WfmSetupPage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  const { role } = await requireTenantUser();

  return (
    <>
      <TabTitle title="Sites & Shifts" />
      <PageHeader
        title="Sites & Shifts"
        subtitle="Geofenced punch locations and working shifts. Adding a site is just adding a row here."
      />
      <WfmSetupClient canEdit={role === "admin"} />
    </>
  );
}

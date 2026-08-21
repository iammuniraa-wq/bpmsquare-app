import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage, getWfmConfig } from "@/lib/wfm/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { wfmEmployeesPayload, wfmShiftsPayload, wfmSitesPayload } from "@/lib/wfm/bootstrap";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import WfmEmployeesClient from "./WfmEmployeesClient";

export default async function WfmEmployeesPage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();

  // Server-prefetch of the client's bootstrap; falls back to client fetch.
  const { supabase, tenantId } = await requireTenantUser();
  const config = await getWfmConfig(createAdminSupabase(), tenantId);
  let initial = null;
  try {
    const [rows, shifts, sites] = await Promise.all([
      wfmEmployeesPayload(supabase, tenantId),
      wfmShiftsPayload(supabase, tenantId),
      wfmSitesPayload(supabase, tenantId),
    ]);
    initial = { rows, shifts, sites } as unknown as React.ComponentProps<typeof WfmEmployeesClient>["initial"];
  } catch { /* client load() handles it */ }

  return (
    <>
      <TabTitle title="Workforce — Employees" />
      <PageHeader
        title="Employees"
        subtitle="Shift and site assignment, punch access and roles. Shares the Employees master data — HR fields live in Master data → Employees."
      />
      <WfmEmployeesClient initial={initial} employmentTypes={config.employment_types} loginMode={config.login_mode} />
    </>
  );
}

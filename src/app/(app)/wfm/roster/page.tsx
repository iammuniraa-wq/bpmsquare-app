import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage, getWfmConfig, dateKeyInTz } from "@/lib/wfm/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { wfmEmployeesPayload, wfmShiftsPayload, wfmSitesPayload, wfmRosterPayload } from "@/lib/wfm/bootstrap";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import RosterClient from "./RosterClient";

export default async function WfmRosterPage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();

  // Server-prefetch the bootstrap payloads (same data the client's load()
  // fetches) so the matrix paints on first render. All-or-nothing: any
  // failure falls back to the client-side fetch path (null props).
  const { supabase, tenantId } = await requireTenantUser();
  let initial = null;
  try {
    const config = await getWfmConfig(createAdminSupabase(), tenantId);
    const from = dateKeyInTz(new Date(), config.timezone);
    const to = dateKeyInTz(new Date(Date.now() + 30 * 86400000), config.timezone); // matches RosterClient's UPCOMING_DAYS
    const [employees, shifts, sites, overrides] = await Promise.all([
      wfmEmployeesPayload(supabase, tenantId),
      wfmShiftsPayload(supabase, tenantId),
      wfmSitesPayload(supabase, tenantId),
      wfmRosterPayload(supabase, tenantId, from, to),
    ]);
    initial = { employees, shifts, sites, overrides } as unknown as React.ComponentProps<typeof RosterClient>["initial"];
  } catch { /* client load() handles it */ }

  return (
    <>
      <TabTitle title="Workforce — Roster" />
      <PageHeader
        title="Roster"
        subtitle="Everyone's standing site and shift; shift changes and days off for specific dates; and who is on which project, by date."
      />
      <RosterClient initial={initial} />
    </>
  );
}

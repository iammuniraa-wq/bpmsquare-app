import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage, getWfmConfig, dateKeyInTz } from "@/lib/wfm/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import {
  wfmEmployeesPayload, wfmShiftsPayload, wfmSitesPayload, wfmRosterPayload,
  wfmCorrectionsPayload, wfmLeaveRequestsPayload, wfmLeaveRecordsPayload, wfmRecheckPayload,
} from "@/lib/wfm/bootstrap";
import TabTitle from "@/components/TabTitle";
import EmployeeHubClient from "./EmployeeHubClient";

export default async function WfmEmployeeHubPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();
  const { id } = await params;

  const { supabase, tenantId } = await requireTenantUser();
  const { data: employee } = await supabase
    .from("employees")
    .select("first_name, last_name")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const tabTitle = employee ? [employee.first_name, employee.last_name].filter(Boolean).join(" ") : "Employee";

  // Server-prefetch the hub's eight secondary lists (same payloads its
  // loadAll() fetches) -- the only remaining client fetch on first load is
  // the core profile/timesheet. All-or-nothing; null falls back to the
  // full client-side loadAll().
  const config = await getWfmConfig(createAdminSupabase(), tenantId);

  type HubLists = React.ComponentProps<typeof EmployeeHubClient>["initialLists"];
  let initialLists: HubLists = null;
  try {
    const from = dateKeyInTz(new Date(), config.timezone);
    const to = dateKeyInTz(new Date(Date.now() + 14 * 86400000), config.timezone); // matches EmployeeHubClient's range
    const [shifts, sites, allEmployees, upcoming, corrections, leaveRequests, leaveRecords, recheck] = await Promise.all([
      wfmShiftsPayload(supabase, tenantId),
      wfmSitesPayload(supabase, tenantId),
      wfmEmployeesPayload(supabase, tenantId),
      wfmRosterPayload(supabase, tenantId, from, to, id),
      wfmCorrectionsPayload(supabase, tenantId, { employeeId: id }),
      wfmLeaveRequestsPayload(supabase, tenantId, { employeeId: id }),
      wfmLeaveRecordsPayload(supabase, tenantId, id),
      wfmRecheckPayload(supabase, tenantId, { employeeId: id }),
    ]);
    initialLists = {
      shifts, sites,
      supervisors: allEmployees.filter((e) => e.wfm_role === "supervisor" && e.id !== id),
      upcoming, corrections, leaveRequests, leaveRecords, recheck,
    } as unknown as HubLists;
  } catch { /* client loadAll() handles it */ }

  return (
    <>
      <TabTitle title={tabTitle} />
      <EmployeeHubClient employeeId={id} initialLists={initialLists} employmentTypes={config.employment_types} />
    </>
  );
}

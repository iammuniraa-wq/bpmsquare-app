import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage, getWfmConfig, dateKeyInTz } from "@/lib/wfm/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import {
  wfmEmployeesPayload, wfmShiftsPayload, wfmSitesPayload, wfmRosterPayload,
  wfmCorrectionsPayload, wfmLeaveRequestsPayload, wfmLeaveRecordsPayload, wfmRecheckPayload,
} from "@/lib/wfm/bootstrap";
import { buildEmployeeHubProfile } from "@/lib/wfm/employeeHub";
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
  type HubProfile = React.ComponentProps<typeof EmployeeHubClient>["initialProfile"];

  // The core profile (identity + this month's totals) is prefetched ALONGSIDE
  // the eight secondary lists, in one parallel batch, and each is caught on
  // its own so a single slow/failing payload no longer drops the whole page
  // back to the 10-call client waterfall (it used to be one shared try). With
  // the profile seeded, the hub paints filled on first render instead of a
  // blank "Loading…" through a Seoul round-trip.
  const from = dateKeyInTz(new Date(), config.timezone);
  const to = dateKeyInTz(new Date(Date.now() + 14 * 86400000), config.timezone); // matches EmployeeHubClient's range
  const safe = async <T,>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

  const [
    profile, shifts, sites, allEmployees, upcoming, corrections, leaveRequests, leaveRecords, recheck,
  ] = await Promise.all([
    safe(buildEmployeeHubProfile(supabase, tenantId, id, null)),
    safe(wfmShiftsPayload(supabase, tenantId)),
    safe(wfmSitesPayload(supabase, tenantId)),
    safe(wfmEmployeesPayload(supabase, tenantId)),
    safe(wfmRosterPayload(supabase, tenantId, from, to, id)),
    safe(wfmCorrectionsPayload(supabase, tenantId, { employeeId: id })),
    safe(wfmLeaveRequestsPayload(supabase, tenantId, { employeeId: id })),
    safe(wfmLeaveRecordsPayload(supabase, tenantId, id)),
    safe(wfmRecheckPayload(supabase, tenantId, { employeeId: id })),
  ]);

  // Lists seed only when the whole set is present -- the client's seeded path
  // assumes all eight are there; a partial set falls back to loadAll().
  const initialLists: HubLists =
    shifts && sites && allEmployees && upcoming && corrections && leaveRequests && leaveRecords && recheck
      ? ({
          shifts, sites,
          supervisors: allEmployees.filter((e) => e.wfm_role === "supervisor" && e.id !== id),
          upcoming, corrections, leaveRequests, leaveRecords, recheck,
        } as unknown as HubLists)
      : null;

  return (
    <>
      <TabTitle title={tabTitle} />
      <EmployeeHubClient
        employeeId={id}
        initialProfile={(profile ?? null) as HubProfile}
        initialLists={initialLists}
        employmentTypes={config.employment_types}
      />
    </>
  );
}

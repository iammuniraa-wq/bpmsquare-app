import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfm, requireWfmSupervisorPage } from "@/lib/wfm/server";
import { resolveWfmScope, filterEmployeesToScope } from "@/lib/wfm/scope";
import { wfmEmployeesPayload, wfmLeaveTypesPayload, wfmLeaveRecordsPayload, wfmLeaveRequestsPayload } from "@/lib/wfm/bootstrap";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import LeaveClient from "./LeaveClient";
import LeaveHolidaysTabs from "./LeaveHolidaysTabs";

export default async function WfmLeavePage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();

  // Server-prefetch of the client's bootstrap (initial filter is "pending"
  // requests, matching LeaveClient's default). Falls back to client fetch.
  // Scoped exactly as the /api/wfm routes the client refreshes from are, so
  // the first paint (and the page payload) never carries people outside the
  // caller's reporting tree.
  let initial = null;
  try {
    const ctx = await requireWfm();
    const { supabase, tenantId } = ctx;
    const scope = await resolveWfmScope(ctx);
    const [types, records, employees, requests] = await Promise.all([
      wfmLeaveTypesPayload(supabase, tenantId),
      wfmLeaveRecordsPayload(supabase, tenantId, null, scope),
      wfmEmployeesPayload(supabase, tenantId).then((rows) => filterEmployeesToScope(rows, scope)),
      wfmLeaveRequestsPayload(supabase, tenantId, { status: "pending", scope }),
    ]);
    initial = { types, records, employees, requests } as unknown as React.ComponentProps<typeof LeaveClient>["initial"];
  } catch { /* client load() handles it */ }

  return (
    <>
      <TabTitle title="Leave & Holidays" />
      <PageHeader
        title="Leave & Holidays"
        subtitle="Approve leave requests, enter leave records directly, and manage the holiday calendar. Leave types are configured in Settings → Workforce."
      />
      <LeaveHolidaysTabs initial={initial} />
    </>
  );
}

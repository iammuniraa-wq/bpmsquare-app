import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { wfmEmployeesPayload, wfmLeaveTypesPayload, wfmLeaveRecordsPayload, wfmLeaveRequestsPayload } from "@/lib/wfm/bootstrap";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import LeaveClient from "./LeaveClient";

export default async function WfmLeavePage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();

  // Server-prefetch of the client's bootstrap (initial filter is "pending"
  // requests, matching LeaveClient's default). Falls back to client fetch.
  const { supabase, tenantId } = await requireTenantUser();
  let initial = null;
  try {
    const [types, records, employees, requests] = await Promise.all([
      wfmLeaveTypesPayload(supabase, tenantId),
      wfmLeaveRecordsPayload(supabase, tenantId),
      wfmEmployeesPayload(supabase, tenantId),
      wfmLeaveRequestsPayload(supabase, tenantId, { status: "pending" }),
    ]);
    initial = { types, records, employees, requests } as unknown as React.ComponentProps<typeof LeaveClient>["initial"];
  } catch { /* client load() handles it */ }

  return (
    <>
      <TabTitle title="Leave" />
      <PageHeader
        title="Leave"
        subtitle="Approve leave requests and enter leave records directly. Leave types and the holiday calendar are configured in Settings → Workforce."
      />
      <LeaveClient initial={initial} />
    </>
  );
}

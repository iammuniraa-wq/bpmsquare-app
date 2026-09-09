import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { wfmEmployeesPayload, wfmLeaveTypesPayload, wfmLeaveRecordsPayload, wfmLeaveRequestsPayload } from "@/lib/wfm/bootstrap";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import LeaveClient from "./LeaveClient";
import HolidaysClient from "./HolidaysClient";
import { c } from "@/lib/theme";

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
      <TabTitle title="Leave & Holidays" />
      <PageHeader
        title="Leave & Holidays"
        subtitle="Approve leave requests, enter leave records directly, and manage the holiday calendar. Leave types are configured in Settings → Workforce."
      />
      <LeaveClient initial={initial} />
      <div style={{ fontSize: 13, fontWeight: 700, color: c.ink, margin: "26px 0 12px" }}>Holidays</div>
      <HolidaysClient />
    </>
  );
}

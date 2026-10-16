import { requireFeature, getTenant } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantToday } from "@/lib/tenantClock";
import { ROUTES } from "@/lib/constants";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import { opportunityStages } from "@/lib/sales/opportunity";
import { listOpportunities, listMembersForPicker } from "@/lib/sales/opportunityServer";
import PipelineBoard from "./PipelineBoard";

/**
 * Pipeline -- the deals board (Sales Engine Piece B, docs/
 * sales-engine-architecture.md §4.5): one column per stage from the
 * tenant's own stage list, cards drag between stages, a closed stage asks
 * for the outcome. Replaces the placeholder that stood here since the
 * journey-board idea; the Nova Flow Board (quotes by status) stays on
 * Quotations.
 */
export default async function PipelinePage() {
  await requireWorkcenterView("pipeline");
  await requireFeature("pipeline");
  const { tenantId, userId } = await requireTenantUser();
  const tenant = await getTenant();
  const admin = createAdminSupabase();
  const [rows, members, todayKey, { data: accounts }] = await Promise.all([
    listOpportunities(admin, tenantId),
    listMembersForPicker(admin, tenantId),
    tenantToday(tenantId),
    admin.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
  ]);
  const stages = opportunityStages(tenant?.config);

  return (
    <>
      <TabTitle title="Pipeline" />
      <PageHeader
        title="Pipeline"
        subtitle={`Sales · ${rows.filter((r) => r.outcome === "open").length} open deals`}
        action={<Button href={ROUTES.pipelineNew} variant="primary">+ New Deal</Button>}
      />
      <PipelineBoard rows={rows} stages={stages} members={members} accounts={accounts ?? []} todayKey={todayKey} currentUserId={userId} />
    </>
  );
}

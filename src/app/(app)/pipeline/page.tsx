import { requireFeature, getTenant } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantToday, tenantTimezone } from "@/lib/tenantClock";
import { ROUTES } from "@/lib/constants";
import Button from "@/components/ui/Button";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import { opportunityStages } from "@/lib/sales/opportunity";
import { listOpportunities, listMembersForPicker } from "@/lib/sales/opportunityServer";
import { listTenders, tenderEnabled } from "@/lib/tender/server";
import { unreadByDeal } from "@/lib/tender/roomServer";
import { tenderStages } from "@/lib/tender/rules";
import type { TenderBoardRow } from "@/lib/tender/views";
import PipelineBoard from "./PipelineBoard";
import PipelineTabs from "./PipelineTabs";

/**
 * Pipeline -- the deals board (Sales Engine Piece B, docs/
 * sales-engine-architecture.md §4.5): one column per stage from the
 * tenant's own stage list, cards drag between stages, a closed stage asks
 * for the outcome. Replaces the placeholder that stood here since the
 * journey-board idea; the Nova Flow Board (quotes by status) stays on
 * Quotations.
 *
 * With the platform-admin flag `gcc_tender` on, the page gains a Tenders tab and the Deals board
 * leaves the tender deals out (docs/design/gcc-tender-deals.md). With it off, nothing below the
 * `tenderOn` branch runs and the page is exactly the board it always was.
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

  if (tenderEnabled(tenant?.features)) {
    const [{ rows: tenderRows, pending }, timezone, unread] = await Promise.all([
      listTenders(admin, tenantId), tenantTimezone(tenantId),
      // The Deal Room's unread counts, only for a workspace that has it.
      tenant?.features?.deal_room === true ? unreadByDeal(admin, tenantId, userId) : Promise.resolve(new Map<string, number>()),
    ]);
    const tenderById = new Map(tenderRows.map((t) => [t.opportunity_id, t]));
    const tenders: TenderBoardRow[] = rows.flatMap((r) => {
      const t = tenderById.get(r.id);
      return t ? [{ ...r, tender: { tender_no: t.tender_no, issuer_name: t.issuer_name, issuer_account_id: t.issuer_account_id, portal: t.portal, closing_at: t.closing_at, decision: t.decision, room_unread: unread.get(r.id) ?? 0 } }] : [];
    });
    return (
      <PipelineTabs
        deals={rows.filter((r) => !tenderById.has(r.id))}
        dealStages={stages}
        tenders={tenders}
        tenderStages={tenderStages()}
        tendersPending={pending}
        members={members}
        accounts={accounts ?? []}
        todayKey={todayKey}
        currentUserId={userId}
        nowIso={new Date().toISOString()}
        timezone={timezone}
      />
    );
  }

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

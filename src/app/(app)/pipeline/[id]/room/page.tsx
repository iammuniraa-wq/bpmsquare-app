import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFeature, getTenant, getUserRole } from "@/lib/tenant";
import { requireWorkcenterView, resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { tenderForDeal } from "@/lib/tender/server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import DealRoom from "@/components/tender/DealRoom";
import { LogCallButton } from "@/components/tender/LogCall";

/**
 * The Deal Room as a page of its own (the way into it on a phone; also a shareable address for colleagues). Same gates as the
 * Room tab and the room routes: the Pipeline module and workcenter, the platform-admin flags gcc_tender and deal_room, and a
 * tender deal of THIS workspace. Anything else is a 404, so the page does not reveal that a room exists.
 */
export default async function DealRoomPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("pipeline");
  await requireFeature("pipeline");
  const { id } = await params;
  const { supabase, tenantId, userId } = await requireTenantUser();
  const tenant = await getTenant();
  if (!(tenant?.features?.gcc_tender === true && tenant.features.deal_room === true)) notFound();
  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  const tender = opp ? await tenderForDeal(admin, tenantId, tenant?.features, id) : null;
  if (!opp || !tender) notFound();
  const role = await getUserRole();
  const canLogCall = canEditWorkcenter(await resolvePermissions(supabase, tenantId, userId, role === "admin" ? "admin" : "member"), "pipeline");

  return (
    <div>
      <TabTitle title={`Room · ${opp.title}`} />
      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.pipelineDetail(id)} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>← {opp.title}</Link>
      </div>
      <PageHeader title="Deal Room" subtitle={[opp.ref, opp.title].filter(Boolean).join(" · ")} />
      <DealRoom opportunityId={id} currentUserId={userId} isAdmin={role === "admin"} headerExtra={canLogCall ? <LogCallButton opportunityId={id} /> : undefined} />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFeature, getTenant } from "@/lib/tenant";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenderCostingLink } from "@/lib/rfq/server";
import { requireWorkcenterView, resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import TabTitle from "@/components/TabTitle";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import NovaTimelineSlot from "@/components/NovaTimelineSlot";
import RfqDetailClient from "./RfqDetailClient";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("rfqs");
  await requireFeature("rfq");
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const { id } = await params;
  const { data } = await supabase.from("rfqs").select("id, ref, title, origin_type, origin_id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!data) notFound();
  // An RFQ raised from a tender goes back to that deal's Costing tab, where it is compared and awarded. Tenant-scoped inside the helper.
  const tenant = await getTenant();
  const costing = await tenderCostingLink(createAdminSupabase(), tenantId, tenant?.features, data).catch(() => null);
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  return (
    <>
      <TabTitle title={`${data.ref ?? "RFQ"} · ${data.title}`} />
      <div style={{ marginBottom: 8 }}>
        <Link href={costing?.href ?? ROUTES.rfqs} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>{costing ? `← ${costing.dealRef ?? "Deal"} · Costing` : "← All RFQs"}</Link>
      </div>
      <RfqDetailClient id={id} canEdit={canEditWorkcenter(perms, "rfqs")} isAdmin={role === "admin"} externalLine={<ExternalRecordSlot objectType="rfqs" objectId={id} />} />
      <NovaTimelineSlot objectType="rfqs" objectId={id} />
    </>
  );
}

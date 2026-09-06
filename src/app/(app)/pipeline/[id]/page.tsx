import { notFound } from "next/navigation";
import Link from "next/link";
import { requireFeature, getTenant } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantToday } from "@/lib/tenantClock";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import TabTitle from "@/components/TabTitle";
import NovaTimelineSlot from "@/components/NovaTimelineSlot";
import { opportunityStages } from "@/lib/sales/opportunity";
import { loadOpportunity, loadOpportunityLines, loadLinkedQuotes, stageSinceMap, listMembersForPicker } from "@/lib/sales/opportunityServer";
import { standardQuoteProducts, pricingOnStandardQuotes } from "../../standard-quotes/formData";
import OpportunityDetailClient from "./OpportunityDetailClient";

export default async function OpportunityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("pipeline");
  await requireFeature("pipeline");
  const { id } = await params;
  const { supabase, tenantId, userId } = await requireTenantUser();
  const tenant = await getTenant();
  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  if (!opp) notFound();

  const [lines, quotes, since, members, products, todayKey, { data: account }, { data: contacts }] = await Promise.all([
    loadOpportunityLines(admin, tenantId, id),
    loadLinkedQuotes(admin, tenantId, id),
    stageSinceMap(admin, tenantId, [opp]),
    listMembersForPicker(admin, tenantId),
    standardQuoteProducts(supabase, tenantId, tenant),
    tenantToday(tenantId),
    admin.from("accounts").select("id, name").eq("id", opp.account_id).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("contacts").select("id, name").eq("account_id", opp.account_id).eq("tenant_id", tenantId).order("name"),
  ]);

  return (
    <>
      <TabTitle title={opp.title} />
      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.pipeline} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>← Pipeline</Link>
      </div>
      <OpportunityDetailClient
        opp={{ ...opp, stage_since: since.get(opp.id) ?? opp.created_at }}
        accountName={account?.name ?? "—"}
        contacts={(contacts ?? []) as { id: string; name: string }[]}
        initialLines={lines}
        quotes={quotes}
        stages={opportunityStages(tenant?.config)}
        members={members}
        products={products}
        pricingEnabled={pricingOnStandardQuotes(tenant)}
        standardQuotesEnabled={tenant?.features?.standard_quotes === true}
        todayKey={todayKey}
        currentUserId={userId}
      />
      <NovaTimelineSlot objectType="opportunities" objectId={id} />
    </>
  );
}

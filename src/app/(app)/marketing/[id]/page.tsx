import { notFound } from "next/navigation";
import { requireFeature, getTenant } from "@/lib/tenant";
import { getMarketingCampaign, listAccounts, countLeadsForCampaign } from "@/lib/data";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import MarketingCampaignDetail from "./MarketingCampaignDetail";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFeature("marketing");
  const { id } = await params;
  const data = await getMarketingCampaign(id);
  if (!data) notFound();

  const summaries = data.campaign.status === "draft" ? await listAccounts() : [];
  const accounts = summaries.map((s) => ({ id: s.account.id, name: s.account.name, type: s.account.type }));
  const tenant = await getTenant();
  const leadsGenerated = data.campaign.status !== "draft" && tenant ? await countLeadsForCampaign(id, tenant.id) : 0;

  return (
    <>
      <TabTitle title={data.campaign.name} />
      <PageHeader title={data.campaign.name} subtitle={data.campaign.subject || "No subject yet"} />
      <MarketingCampaignDetail campaign={data.campaign} recipients={data.recipients} accounts={accounts} leadsGenerated={leadsGenerated} />
    </>
  );
}

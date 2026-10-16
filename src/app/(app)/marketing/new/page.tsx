import { requireFeature } from "@/lib/tenant";
import { listAccounts } from "@/lib/data";
import MarketingComposeForm from "./MarketingComposeForm";

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  await requireFeature("marketing");
  const { group } = await searchParams;
  const summaries = await listAccounts();
  const accounts = summaries.map((s) => ({ id: s.account.id, name: s.account.name, type: s.account.type }));

  return <MarketingComposeForm accounts={accounts} initialGroupId={group} />;
}

import { requireFeature } from "@/lib/tenant";
import { listAccounts } from "@/lib/data";
import PageHeader from "@/components/PageHeader";
import MarketingComposeForm from "./MarketingComposeForm";

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  await requireFeature("marketing");
  const { group } = await searchParams;
  const summaries = await listAccounts();
  const accounts = summaries.map((s) => ({ id: s.account.id, name: s.account.name, type: s.account.type }));

  return (
    <>
      <PageHeader title="New campaign" subtitle="Send a rich-text email to a filtered set of accounts" />
      <MarketingComposeForm accounts={accounts} initialGroupId={group} />
    </>
  );
}

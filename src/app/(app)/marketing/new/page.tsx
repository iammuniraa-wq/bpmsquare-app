import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterEdit } from "@/lib/permissions";
import { listAccounts } from "@/lib/data";
import { requireTenantUser } from "@/lib/supabase-server";
import { loadComposeNewsletter } from "@/lib/newsletter/composeData";
import MarketingComposeForm from "./MarketingComposeForm";

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ group?: string; newsletter?: string }> }) {
  await requireWorkcenterEdit("marketing");
  await requireFeature("marketing");
  const { group, newsletter } = await searchParams;
  // "Use in a campaign" arrives with a version id. A workspace without the Newsletter Studio, or an id
  // that is not this workspace's, gets the ordinary form: the parameter is simply ignored.
  const nl = newsletter ? await loadComposeNewsletter((await requireTenantUser()).tenantId, newsletter) : null;
  const summaries = await listAccounts();
  const accounts = summaries.map((s) => ({ id: s.account.id, name: s.account.name, type: s.account.type }));

  return <MarketingComposeForm accounts={accounts} initialGroupId={group} newsletter={nl} />;
}

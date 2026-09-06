import { requireFeature, getTenant } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { opportunityStages } from "@/lib/sales/opportunity";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";
import NewOpportunityForm from "./NewOpportunityForm";

export default async function NewOpportunityPage() {
  await requireWorkcenterView("pipeline");
  await requireFeature("pipeline");
  const { tenantId, userId } = await requireTenantUser();
  const tenant = await getTenant();
  const admin = createAdminSupabase();
  const [{ data: accounts }, { data: contacts }, members] = await Promise.all([
    admin.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
    admin.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).order("name"),
    listMembersForPicker(admin, tenantId),
  ]);
  return (
    <NewOpportunityForm
      accounts={accounts ?? []}
      contacts={(contacts ?? []) as { id: string; name: string; account_id: string }[]}
      members={members}
      stages={opportunityStages(tenant?.config).filter((s) => !s.is_closed)}
      currentUserId={userId}
    />
  );
}

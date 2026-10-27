import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import NewContractProjectForm from "./NewContractProjectForm";

/** New contract project by hand (the usual way in is "Create contract project" on an awarded tender). */
export default async function NewContractProjectPage() {
  await requireWorkcenterView("contract_projects");
  await requireFeature("contract_projects");
  const { tenantId } = await requireTenantUser();
  const { data: accounts } = await createAdminSupabase().from("accounts").select("id, name").eq("tenant_id", tenantId).order("name");
  return <NewContractProjectForm accounts={(accounts ?? []) as { id: string; name: string }[]} />;
}

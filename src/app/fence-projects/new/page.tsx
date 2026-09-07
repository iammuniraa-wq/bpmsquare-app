import { getTenant, requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { getFenceSecurityProfiles } from "@/lib/fence/data";
import { getFenceProductCatalog } from "@/lib/fence/materials";
import NewFenceProjectClient from "./NewFenceProjectClient";

export default async function NewFenceProjectPage() {
  await requireWorkcenterView("fence_projects");
  await requireFeature("fence_projects");
  const tenant = await getTenant();
  const tenantId = tenant!.id;
  const { supabase } = await requireTenantUser();

  const [profiles, catalog, { data: accountRows }, { data: contactRows }] = await Promise.all([
    getFenceSecurityProfiles(tenantId),
    getFenceProductCatalog(tenantId),
    supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).order("name"),
  ]);

  return (
    <NewFenceProjectClient
      profiles={profiles}
      catalog={catalog}
      accounts={accountRows ?? []}
      contacts={contactRows ?? []}
    />
  );
}

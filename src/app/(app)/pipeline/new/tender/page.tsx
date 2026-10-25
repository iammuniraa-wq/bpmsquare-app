import { notFound } from "next/navigation";
import { requireFeature, getTenant } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenderEnabled } from "@/lib/tender/server";
import NewTenderForm from "./NewTenderForm";

/** New tender (GCC tender deals): only in a workspace the platform admin switched `gcc_tender` on for; elsewhere a 404, like a page that does not exist. */
export default async function NewTenderPage() {
  await requireWorkcenterView("pipeline");
  await requireFeature("pipeline");
  const { tenantId } = await requireTenantUser();
  const tenant = await getTenant();
  if (!tenderEnabled(tenant?.features)) notFound();
  const admin = createAdminSupabase();
  const { data: accounts } = await admin.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name");
  return <NewTenderForm accounts={accounts ?? []} />;
}

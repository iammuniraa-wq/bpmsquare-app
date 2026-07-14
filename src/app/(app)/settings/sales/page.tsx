import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import SalesConfigClient from "./SalesConfigClient";

export default async function SalesConfigPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const { data } = await createAdminSupabase()
    .from("tenants")
    .select("config")
    .eq("id", tenantId!)
    .single();

  const cfg = (data?.config ?? {}) as { territories?: string[]; sales_orgs?: string[] };

  return (
    <>
      <PageHeader
        title="Sales config"
        subtitle="Manage territory and sales org picklist values"
      />
      <SalesConfigClient
        initialTerritories={cfg.territories ?? []}
        initialSalesOrgs={cfg.sales_orgs ?? []}
      />
    </>
  );
}

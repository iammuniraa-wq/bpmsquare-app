import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { ROUTES, type QuoteStatusDef } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import StatusesClient from "./StatusesClient";

export default async function StatusesPage() {
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

  const cfg = data?.config as { quote_statuses?: QuoteStatusDef[]; asset_print_fields?: string[] } | null;
  const statuses: QuoteStatusDef[] | null = cfg?.quote_statuses ?? null;
  const assetPrintFields: string[] = cfg?.asset_print_fields ?? [];

  return (
    <>
      <PageHeader
        title="Statuses & assets"
        subtitle="Configure pipeline stages and equipment print fields"
      />
      <StatusesClient initial={statuses} initialAssetFields={assetPrintFields} />
    </>
  );
}

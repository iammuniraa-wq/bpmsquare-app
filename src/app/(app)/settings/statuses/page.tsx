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

  const statuses: QuoteStatusDef[] | null =
    (data?.config as { quote_statuses?: QuoteStatusDef[] })?.quote_statuses ?? null;

  return (
    <>
      <PageHeader
        title="Quote statuses"
        subtitle="Configure the pipeline stages for your quotations"
      />
      <StatusesClient initial={statuses} />
    </>
  );
}

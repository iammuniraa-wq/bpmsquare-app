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

  const cfg = data?.config as { quote_statuses?: QuoteStatusDef[] } | null;
  const statuses: QuoteStatusDef[] | null = cfg?.quote_statuses ?? null;

  return (
    <>
      <PageHeader
        title="Pipeline & quote statuses"
        subtitle="The stages a quotation moves through, and which ones close it"
      />
      <StatusesClient initial={statuses} />
    </>
  );
}

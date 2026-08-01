import { notFound, redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TemplateBuilderClient from "./TemplateBuilderClient";

export default async function StandardQuoteTemplateBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  let role: string;
  let supabase, tenantId;
  try {
    ({ supabase, tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.dashboard);
  }
  if (role !== "admin") redirect(ROUTES.standardQuotes);

  const { id } = await params;
  const [{ data: template }, tenant] = await Promise.all([
    supabase.from("standard_quote_templates").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle(),
    getTenant(),
  ]);
  if (!template) notFound();

  return (
    <>
      <PageHeader title={`Template: ${template.name}`} subtitle="Reorder, show/hide, and write branded content for each block. Changes save when you click Save." />
      <TemplateBuilderClient
        template={template}
        companyInfo={tenant?.company_info ?? {}}
        logoUrl={tenant?.logo_url ?? null}
      />
    </>
  );
}

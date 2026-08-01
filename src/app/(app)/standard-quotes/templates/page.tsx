import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/tenant";
import { listStandardQuoteTemplates } from "@/lib/data/live";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TemplatesListClient from "./TemplatesListClient";

export default async function StandardQuoteTemplatesPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.dashboard);
  }
  if (role !== "admin") redirect(ROUTES.standardQuotes);
  await requireFeature("standard_quotes");

  const templates = await listStandardQuoteTemplates();

  return (
    <>
      <PageHeader
        title="Standard Quote Templates"
        subtitle="Branded, reusable layouts for Standard Quotes — each quote picks one at creation. Admin only."
      />
      <TemplatesListClient
        templates={templates.map((t) => ({ id: t.id, name: t.name, is_default: t.is_default, updated_at: t.updated_at }))}
      />
    </>
  );
}

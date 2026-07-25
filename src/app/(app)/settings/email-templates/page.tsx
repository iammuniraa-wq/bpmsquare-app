import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import type { EmailTemplate } from "@/lib/types";
import PageHeader from "@/components/PageHeader";
import EmailTemplatesClient from "./EmailTemplatesClient";

export default async function EmailTemplatesPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const { data } = await createAdminSupabase()
    .from("email_templates")
    .select("*")
    .eq("tenant_id", tenantId!)
    .order("category")
    .order("created_at");

  return (
    <>
      <PageHeader
        title="Email templates"
        subtitle="Subject and body pairs your team can pick between when emailing a quote"
      />
      <EmailTemplatesClient initial={(data ?? []) as EmailTemplate[]} />
    </>
  );
}

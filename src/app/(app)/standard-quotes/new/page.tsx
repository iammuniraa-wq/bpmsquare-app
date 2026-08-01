import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { listStandardQuoteTemplates } from "@/lib/data/live";
import StandardQuoteForm from "./StandardQuoteForm";

export default async function NewStandardQuotePage() {
  await requireWorkcenterView("standard_quotes");
  await requireFeature("standard_quotes");
  const { supabase, tenantId } = await requireTenantUser();

  const [{ data: accounts }, { data: contacts }, templates] = await Promise.all([
    supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).order("name"),
    listStandardQuoteTemplates(),
  ]);

  return (
    <StandardQuoteForm
      accounts={accounts ?? []}
      contacts={contacts ?? []}
      templates={templates.map((t) => ({ id: t.id, name: t.name, is_default: t.is_default }))}
    />
  );
}

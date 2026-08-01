import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import StandardQuoteForm from "./StandardQuoteForm";

export default async function NewStandardQuotePage() {
  await requireWorkcenterView("standard_quotes");
  const { supabase, tenantId } = await requireTenantUser();

  const [{ data: accounts }, { data: contacts }] = await Promise.all([
    supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).order("name"),
  ]);

  return <StandardQuoteForm accounts={accounts ?? []} contacts={contacts ?? []} />;
}

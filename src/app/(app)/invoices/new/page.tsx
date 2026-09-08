import { requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import InvoiceForm from "./InvoiceForm";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ account_id?: string }>;
}) {
  await requireFeature("invoices");
  const { account_id } = await searchParams;
  const { supabase, tenantId } = await requireTenantUser();

  const [{ data: accounts }, { data: contacts }, { data: tenantRow }, { data: approvedQuotes }, { data: invoicedQuotes }] = await Promise.all([
    supabase.from("accounts").select("id, name").eq("tenant_id", tenantId).order("name"),
    supabase.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).order("name"),
    supabase.from("tenants").select("config").eq("id", tenantId).single(),
    supabase
      .from("quotes")
      .select("id, ref, account_id, contact_id, entity_id, quote_lines(sl_no, description, uom, qty, rate, amount)")
      .eq("tenant_id", tenantId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("invoices").select("quote_id").eq("tenant_id", tenantId).not("quote_id", "is", null),
  ]);

  const invoicedQuoteIds = new Set((invoicedQuotes ?? []).map((r) => r.quote_id));
  const quotes = (approvedQuotes ?? [])
    .filter((q) => !invoicedQuoteIds.has(q.id))
    .map((q) => ({
      id: q.id, ref: q.ref, account_id: q.account_id, contact_id: q.contact_id, entity_id: q.entity_id,
      lines: (q.quote_lines ?? []) as { sl_no: string | null; description: string; uom: string | null; qty: number; rate: number; amount: number }[],
    }));

  const entities = (tenantRow?.config as { entities?: { id: string; name: string; is_default?: boolean }[] } | null)?.entities ?? [];

  return (
    <InvoiceForm
      accounts={accounts ?? []}
      contacts={contacts ?? []}
      entities={entities}
      quotes={quotes}
      defaultAccountId={account_id ?? null}
    />
  );
}

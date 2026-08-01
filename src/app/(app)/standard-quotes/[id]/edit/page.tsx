import { notFound, redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { getStandardQuoteLive, listStandardQuoteTemplates } from "@/lib/data/live";
import { ROUTES } from "@/lib/constants";
import StandardQuoteForm from "../../new/StandardQuoteForm";

export default async function EditStandardQuotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("standard_quotes");
  await requireFeature("standard_quotes");
  const { id } = await params;
  const { supabase, tenantId } = await requireTenantUser();

  const data = await getStandardQuoteLive(id);
  if (!data) notFound();
  const { quote, lines } = data;

  if (quote.status !== "draft") redirect(ROUTES.standardQuote(id));

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
      editQuote={{
        id: quote.id, ref: quote.ref, account_id: quote.account_id, contact_id: quote.contact_id,
        valid_until: quote.valid_until, notes: quote.notes, terms: quote.terms, template_id: quote.template_id,
        header_discount_pct: quote.header_discount_pct, tax_pct: quote.tax_pct,
        shipping_amount: quote.shipping_amount, intro_text: quote.intro_text,
        lines: lines.map((l) => ({ sl_no: l.sl_no, description: l.description, uom: l.uom, qty: l.qty, rate: l.rate, discount_pct: l.discount_pct })),
      }}
    />
  );
}

import { notFound } from "next/navigation";
import { getInvoiceLive } from "@/lib/data/live";
import { getTenant, getTenantCurrency } from "@/lib/tenant";
import InvoicePrint from "@/components/InvoicePrint";
import { createAdminSupabase } from "@/lib/supabase-server";
import { einvoicingOn } from "@/lib/einvoicing/gate";
import { evaluateInvoice } from "@/lib/einvoicing/evaluate";
import { buildKsaPrintData } from "@/lib/einvoicing/printData";

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tenant, currency] = await Promise.all([getInvoiceLive(id), getTenant(), getTenantCurrency()]);
  if (!data) notFound();

  const { invoice, lines, payments, account, contact } = data;

  // Saudi e-invoicing workspaces print the bilingual layout. Every other workspace gets exactly the layout it always had:
  // `ksa` is simply not passed.
  let ksa;
  if (tenant && einvoicingOn(tenant.features, tenant.config)) {
    const ev = evaluateInvoice({
      invoice, lines, account, entities: tenant.config?.entities, config: tenant.config, currency: currency.code,
    });
    let originalRef: string | null = null;
    if (invoice.original_invoice_id) {
      const { data: original } = await createAdminSupabase()
        .from("invoices").select("ref").eq("id", invoice.original_invoice_id).eq("tenant_id", tenant.id).maybeSingle();
      originalRef = (original as { ref?: string } | null)?.ref ?? null;
    }
    ksa = buildKsaPrintData(ev, invoice, originalRef);
  }

  return (
    <InvoicePrint
      invoice={invoice}
      lines={lines}
      payments={payments}
      account={account}
      contact={contact}
      companyInfo={tenant?.company_info ?? {}}
      logoUrl={tenant?.logo_url ?? null}
      tenantEntities={tenant?.config?.entities ?? []}
      tenantTax={tenant?.config?.tax ?? { label: "GST", rate: 18, inclusive: false }}
      currency={currency.code}
      ksa={ksa}
    />
  );
}

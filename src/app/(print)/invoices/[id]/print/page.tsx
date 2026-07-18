import { notFound } from "next/navigation";
import { getInvoiceLive } from "@/lib/data/live";
import { getTenant } from "@/lib/tenant";
import InvoicePrint from "@/components/InvoicePrint";

export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tenant] = await Promise.all([getInvoiceLive(id), getTenant()]);
  if (!data) notFound();

  const { invoice, lines, payments, account, contact } = data;

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
    />
  );
}

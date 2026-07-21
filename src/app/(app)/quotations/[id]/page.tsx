import { notFound } from "next/navigation";
import { getQuote } from "@/lib/data";
import { getTenant } from "@/lib/tenant";
import { OFFER_TYPE_LABEL, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import QuoteDetailLayout from "@/components/QuoteDetailLayout";

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [data, tenant] = await Promise.all([getQuote(id), getTenant()]);
  if (!data) notFound();

  const { quote, account, contact, lines, workOrders, existingInvoice, assets } = data;
  const tenantTax = tenant?.config?.tax ?? { label: "GST", rate: 18, inclusive: false };
  const quoteStatuses: QuoteStatusDef[] =
    (tenant?.config as { quote_statuses?: QuoteStatusDef[] })?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;
  const offerLabel = OFFER_TYPE_LABEL[quote.type] ?? "Quotation";

  return (
    <>
      <TabTitle title={quote.ref} />
      <PageHeader
        title={quote.ref}
        subtitle={`Sales · ${offerLabel} · ${account?.name ?? ""}`}
      />
      <QuoteDetailLayout
        quote={quote as Parameters<typeof QuoteDetailLayout>[0]["quote"]}
        account={account}
        contact={contact}
        lines={lines}
        workOrders={workOrders as Parameters<typeof QuoteDetailLayout>[0]["workOrders"]}
        tenantTax={tenantTax}
        quoteStatuses={quoteStatuses}
        existingInvoice={existingInvoice}
        assets={assets}
      />
    </>
  );
}

import { notFound } from "next/navigation";
import { getQuote } from "@/lib/data";
import { getTenant } from "@/lib/tenant";
import { OFFER_TYPE_LABEL, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import QuoteDetailLayout from "@/components/QuoteDetailLayout";
import { signQuotePublicToken, buildAbsoluteUrl } from "@/lib/quotePublicLink";
import { createAdminSupabase } from "@/lib/supabase-server";
import { rfqLineStatuses } from "@/lib/rfq/server";
import RecordRfqsCard from "@/components/rfq/RecordRfqsCard";
import { rfqPrefill } from "@/components/rfq/prefill";

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

  const publicToken = signQuotePublicToken(quote.id);
  const publicPdfLink = publicToken
    ? await buildAbsoluteUrl(`/api/quotes/${quote.id}/pdf-public/${publicToken}`)
    : null;

  // RFQ (0128) -- only for a tenant that bought the module; for everyone
  // else nothing below renders and the page is exactly as before.
  const rfqOn = tenant?.features?.rfq === true;
  const lineRfqIds = (lines as { rfq_line_id?: string | null }[]).map((l) => l.rfq_line_id ?? "").filter(Boolean);
  const rfqStatus = rfqOn ? await rfqLineStatuses(createAdminSupabase(), tenant!.id, lineRfqIds) : undefined;

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
        publicPdfLink={publicPdfLink}
        rfqStatus={rfqStatus}
      />
      {rfqOn && (
        <RecordRfqsCard
          origin={{ type: "quote", id: quote.id }}
          originLabel={`Quotation ${quote.ref}${account?.name ? ` for ${account.name}` : ""}`}
          title={`Prices for ${quote.ref}${account?.name ? ` (${account.name})` : ""}`}
          lines={rfqPrefill(lines.map((l) => ({ ...l, uom: l.uom ?? null })) as Parameters<typeof rfqPrefill>[0], (rl) => rfqStatus?.[rl]?.ref ?? null)}
        />
      )}
    </>
  );
}

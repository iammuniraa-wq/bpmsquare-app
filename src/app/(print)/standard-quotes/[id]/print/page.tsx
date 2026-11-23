import { notFound } from "next/navigation";
import { getStandardQuoteLive } from "@/lib/data/live";
import { getTenant, getTenantCurrency } from "@/lib/tenant";
import StandardQuotePrint from "@/components/StandardQuotePrint";
import StandardQuoteFramedPrint from "@/components/StandardQuoteFramedPrint";
import { quoteBlocks, standardQuoteFrame } from "@/lib/pdf/standardQuoteFrame";

export default async function StandardQuotePrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pdf?: string }> }) {
  const { id } = await params;
  const { pdf } = await searchParams;
  const [data, tenant, currency] = await Promise.all([getStandardQuoteLive(id), getTenant(), getTenantCurrency()]);
  if (!data || !tenant?.features?.standard_quotes) notFound();

  const { quote, lines, account, contact, template } = data;

  // A workspace that chose a page frame prints inside it; every other workspace gets the layout it always had.
  const blocks = quoteBlocks(template);
  const frame = await standardQuoteFrame(tenant, quote, account, blocks, null);
  if (frame) {
    return (
      <StandardQuoteFramedPrint
        quote={quote} lines={lines} account={account} contact={contact} blocks={blocks} docSections={quote.doc_sections ?? null}
        currency={currency.code} pdfMode={pdf === "1"}
        frame={{ bodyCss: frame.bodyCss, fontFaceCss: frame.fontFaceCss, previewHeaderHtml: frame.previewHeaderHtml, previewFooterHtml: frame.previewFooterHtml, marginsMm: frame.marginsMm, pageFormat: frame.pageFormat }}
      />
    );
  }

  return (
    <StandardQuotePrint
      quote={quote}
      lines={lines}
      account={account}
      contact={contact}
      companyInfo={tenant?.company_info ?? {}}
      logoUrl={tenant?.logo_url ?? null}
      template={template}
      currency={currency.code}
    />
  );
}

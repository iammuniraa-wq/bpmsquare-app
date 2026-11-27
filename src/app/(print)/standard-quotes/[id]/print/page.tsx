import { notFound } from "next/navigation";
import { getStandardQuoteLive } from "@/lib/data/live";
import { getTenant, getTenantCurrency } from "@/lib/tenant";
import StandardQuotePrint from "@/components/StandardQuotePrint";
import StandardQuoteFramedPrint from "@/components/StandardQuoteFramedPrint";
import { quoteBlocks, standardQuoteFrame } from "@/lib/pdf/standardQuoteFrame";
import { buildFrameFromSnapshot } from "@/lib/pdf/frameServer";
import { createAdminSupabase } from "@/lib/supabase-server";
import { loadRevisionSnapshot } from "@/lib/revisions/server";
import { printedRevisionNo, revisionsActive } from "@/lib/revisions/state";
import { snapshotForPrint } from "@/lib/revisions/snapshot";
import type { StandardQuoteTemplate } from "@/lib/types";
import { quoteTaxLabel } from "@/lib/standardQuoteTotals";

export default async function StandardQuotePrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pdf?: string; rev?: string }> }) {
  const { id } = await params;
  const { pdf, rev } = await searchParams;
  const [data, tenant, currency] = await Promise.all([getStandardQuoteLive(id), getTenant(), getTenantCurrency()]);
  if (!data || !tenant?.features?.standard_quotes) notFound();

  const { quote, lines, account, contact, template } = data;
  const taxLabel = quoteTaxLabel(tenant.company_info, tenant.config?.tax);

  // Revision history (0252): an issued quotation, or "?rev=N", prints from what that revision froze, through the frame as it was.
  const active = revisionsActive(tenant.config, quote);
  const wanted = active && rev !== undefined && /^\d{1,4}$/.test(rev) ? Number(rev) : active && quote.revision_state === "issued" ? quote.current_revision ?? null : null;
  if (wanted !== null) {
    const found = await loadRevisionSnapshot(createAdminSupabase(), quote.tenant_id, quote.id, wanted);
    if (!found) notFound();
    const snap = found.snapshot;
    const printed = snapshotForPrint(snap, { quoteId: quote.id, tenantId: quote.tenant_id, status: quote.status });
    const snapFrame = await buildFrameFromSnapshot(snap, wanted);
    if (snapFrame) {
      return (
        <StandardQuoteFramedPrint
          quote={printed.quote} lines={printed.lines} account={printed.account} contact={printed.contact} blocks={snap.template.blocks} docSections={snap.quote.doc_sections}
          currency={snap.currency} taxLabel={taxLabel} pdfMode={pdf === "1"} rev={wanted}
          frame={{ bodyCss: snapFrame.bodyCss, fontFaceCss: snapFrame.fontFaceCss, previewHeaderHtml: snapFrame.previewHeaderHtml, previewFooterHtml: snapFrame.previewFooterHtml, marginsMm: snapFrame.marginsMm, pageFormat: snapFrame.pageFormat }}
        />
      );
    }
    return (
      <StandardQuotePrint
        quote={printed.quote} lines={printed.lines} account={printed.account} contact={printed.contact}
        companyInfo={snap.frame.company_info} logoUrl={snap.frame.logo_url}
        template={{ id: snap.template.id ?? "", tenant_id: quote.tenant_id, name: snap.template.name ?? "", is_default: false, accent_color: snap.template.accent_color, logo_position: snap.template.logo_position, blocks: snap.template.blocks, created_at: "", updated_at: "" } as StandardQuoteTemplate}
        currency={snap.currency} taxLabel={taxLabel} pdfHref={`/api/standard-quotes/${quote.id}/pdf?rev=${wanted}`}
      />
    );
  }

  // A workspace that chose a page frame prints inside it; every other workspace gets the layout it always had.
  const blocks = quoteBlocks(template);
  const frame = await standardQuoteFrame(tenant, quote, account, blocks, active ? printedRevisionNo(quote) : null);
  if (frame) {
    return (
      <StandardQuoteFramedPrint
        quote={quote} lines={lines} account={account} contact={contact} blocks={blocks} docSections={quote.doc_sections ?? null}
        currency={currency.code} taxLabel={taxLabel} pdfMode={pdf === "1"}
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
      taxLabel={taxLabel}
    />
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getQuote } from "@/lib/data";
import { getTenant } from "@/lib/tenant";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { Asset } from "@/lib/types";
import QuotePrint from "@/components/QuotePrint";
import { getExtension } from "@/extensions/registry";
import { signQuotePublicToken, buildAbsoluteUrl } from "@/lib/quotePublicLink";

// The page <title> is what a browser's print/Save-as-PDF dialog suggests as
// the filename (relevant now that "Download PDF" drives that dialog
// directly -- see QuotePrint.tsx). Left at the app's default, every quote
// saved this way suggested the same generic tenant name; quote.ref (e.g.
// "QT2026-0229" -- the same value the old server-side Content-Disposition
// filename used) makes each download distinguishable. ref, not ref_no: the
// latter is the customer's own free-text reference and can contain "/",
// which isn't a safe filename character on every OS.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const data = await getQuote(id);
  return { title: data?.quote.ref || "Quotation" };
}

export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tenant] = await Promise.all([getQuote(id), getTenant()]);
  if (!data) notFound();

  const { quote, account, contact, site, lines, revisions } = data;
  const assets: Asset[] = (data as { assets?: Asset[] }).assets ?? [];
  const assetPrintFields: string[] =
    (tenant?.config as { asset_print_fields?: string[] })?.asset_print_fields ?? [];

  // Custom asset fields (cf_*) need their tenant-defined labels for the Equipment Details
  // section -- ASSET_FIELD_LABELS in QuotePrint.tsx only covers the base Asset columns.
  const assetCustomFieldLabels: Record<string, string> = {};
  if (tenant) {
    const { data: customFields } = await createAdminSupabase()
      .from("custom_fields")
      .select("field_key, field_label")
      .eq("tenant_id", tenant.id)
      .eq("object_type", "asset");
    for (const f of customFields ?? []) assetCustomFieldLabels[f.field_key] = f.field_label;
  }

  let ext: Awaited<ReturnType<typeof getExtension>>;
  try {
    ext = await getExtension(tenant?.slug);
  } catch (e: unknown) {
    console.error("[quote print] extension load failed for slug", tenant?.slug, e);
    ext = await getExtension(undefined); // fall back to the no-op base extension
  }
  const ctx = { companyName: tenant?.name ?? "", accountName: account?.name ?? null };

  const publicToken = signQuotePublicToken(quote.id);
  const publicPdfLink = publicToken
    ? await buildAbsoluteUrl(`/api/quotes/${quote.id}/pdf-public/${publicToken}`)
    : null;

  return (
    <QuotePrint
      publicPdfLink={publicPdfLink}
      quote={quote}
      account={account}
      contact={contact}
      site={site}
      lines={lines}
      revisions={revisions}
      companyInfo={tenant?.company_info ?? {}}
      logoUrl={tenant?.logo_url ?? null}
      tenantEntities={tenant?.config?.entities ?? []}
      tenantTax={tenant?.config?.tax ?? { label: "GST", rate: 18, inclusive: false }}
      assets={assets}
      assetPrintFields={assetPrintFields}
      assetCustomFieldLabels={assetCustomFieldLabels}
      ext={{
        quoteSignatureSlot: ext.quoteSignatureSlot?.(ctx) ?? null,
        quoteExtraSection: ext.quoteExtraSection?.(ctx) ?? null,
        quoteSubject: quote.name ? (ext.quoteSubject?.(quote.name) ?? quote.name) : null,
      }}
    />
  );
}

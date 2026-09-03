import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getQuoteByPublicToken, getTenantForPublicQuote } from "@/lib/data";
import { verifyQuotePublicToken } from "@/lib/quotePublicLink";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { Asset } from "@/lib/types";
import QuotePrintPublic from "@/components/QuotePrintPublic";
import { getExtension } from "@/extensions/registry";

// See the matching comment in ../../print/page.tsx -- the page <title> is
// what a browser's print/Save-as-PDF dialog suggests as the filename.
export async function generateMetadata({ params }: { params: Promise<{ id: string; token: string }> }): Promise<Metadata> {
  const { id, token } = await params;
  if (!verifyQuotePublicToken(id, token)) return { title: "Quotation" };
  const data = await getQuoteByPublicToken(id);
  return { title: data?.quote.ref || "Quotation" };
}

// No login required -- reached via a signed, expiring link (see lib/quotePublicLink.ts),
// e.g. shared over WhatsApp. Token is verified against the exact quote id in the URL
// before any data is fetched; every query after that is still tenant-scoped internally
// (see getQuoteByPublicTokenLive / getTenantForPublicQuoteLive in data/live.ts).
export default async function QuotePublicPrintPage({ params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  if (!verifyQuotePublicToken(id, token)) notFound();

  const data = await getQuoteByPublicToken(id);
  if (!data) notFound();
  const { quote, account, contact, site, lines, revisions, tenantId } = data;
  const assets: Asset[] = (data as { assets?: Asset[] }).assets ?? [];

  const tenant = await getTenantForPublicQuote(tenantId);
  const assetPrintFields: string[] = (tenant?.config as { asset_print_fields?: string[] })?.asset_print_fields ?? [];

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
    console.error("[quote public print] extension load failed for slug", tenant?.slug, e);
    ext = await getExtension(undefined);
  }
  const ctx = { companyName: tenant?.name ?? "", accountName: account?.name ?? null };

  return (
    <QuotePrintPublic
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

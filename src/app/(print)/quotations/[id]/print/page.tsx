import { notFound } from "next/navigation";
import { getQuote } from "@/lib/data";
import { getTenant } from "@/lib/tenant";
import type { Asset } from "@/lib/types";
import QuotePrint from "@/components/QuotePrint";
import { getExtension } from "@/extensions/registry";

export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tenant] = await Promise.all([getQuote(id), getTenant()]);
  if (!data) notFound();

  const { quote, account, contact, site, lines, revisions } = data;
  const assets: Asset[] = (data as { assets?: Asset[] }).assets ?? [];
  const assetPrintFields: string[] =
    (tenant?.config as { asset_print_fields?: string[] })?.asset_print_fields ?? [];

  const ext = await getExtension(tenant?.slug);
  const ctx = { companyName: tenant?.name ?? "", accountName: account?.name ?? null };

  return (
    <QuotePrint
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
      ext={{
        quoteSignatureSlot: ext.quoteSignatureSlot?.(ctx) ?? null,
        quoteExtraSection: ext.quoteExtraSection?.(ctx) ?? null,
      }}
    />
  );
}

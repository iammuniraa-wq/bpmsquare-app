import { notFound } from "next/navigation";
import { getQuote } from "@/lib/data";
import { getTenant } from "@/lib/tenant";
import QuotePrint from "@/components/QuotePrint";

export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tenant] = await Promise.all([getQuote(id), getTenant()]);
  if (!data) notFound();

  const { quote, account, contact, site, lines, revisions } = data;
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
    />
  );
}

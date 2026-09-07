import { notFound } from "next/navigation";
import { getStandardQuoteLive } from "@/lib/data/live";
import { getTenant, getTenantCurrency } from "@/lib/tenant";
import StandardQuotePrint from "@/components/StandardQuotePrint";

export default async function StandardQuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tenant, currency] = await Promise.all([getStandardQuoteLive(id), getTenant(), getTenantCurrency()]);
  if (!data || !tenant?.features?.standard_quotes) notFound();

  const { quote, lines, account, contact, template } = data;

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

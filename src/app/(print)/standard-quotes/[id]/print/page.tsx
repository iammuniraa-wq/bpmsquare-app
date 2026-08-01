import { notFound } from "next/navigation";
import { getStandardQuoteLive } from "@/lib/data/live";
import { getTenant } from "@/lib/tenant";
import StandardQuotePrint from "@/components/StandardQuotePrint";

export default async function StandardQuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, tenant] = await Promise.all([getStandardQuoteLive(id), getTenant()]);
  if (!data) notFound();

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
    />
  );
}

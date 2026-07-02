import { notFound } from "next/navigation";
import { getQuote } from "@/lib/data";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import QuoteDetailLayout from "@/components/QuoteDetailLayout";

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getQuote(id);
  if (!data) notFound();

  const { quote, account, contact, lines, workOrders } = data;

  return (
    <>
      <TabTitle title={quote.ref} />
      <PageHeader
        title={quote.ref}
        subtitle={`Sales · Quotation · ${account?.name ?? ""}`}
      />
      <QuoteDetailLayout
        quote={quote as Parameters<typeof QuoteDetailLayout>[0]["quote"]}
        account={account}
        contact={contact}
        lines={lines}
        workOrders={workOrders as Parameters<typeof QuoteDetailLayout>[0]["workOrders"]}
      />
    </>
  );
}

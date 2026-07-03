import { getQuoteFormData } from "@/lib/data";
import QuoteForm from "./QuoteForm";
import QuoteFormSupply from "./QuoteFormSupply";
import QuoteTypePicker from "./QuoteTypePicker";

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;

  // No type selected → show picker
  if (!type) return <QuoteTypePicker />;

  const data = await getQuoteFormData();

  if (type === "supply") {
    return <QuoteFormSupply accounts={data.accounts} contacts={data.contacts} />;
  }

  // Default: repair (and any unknown type falls back to repair)
  return <QuoteForm {...data} />;
}

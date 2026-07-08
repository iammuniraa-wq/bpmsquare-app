import { getQuoteFormData } from "@/lib/data";
import type { QuoteOfferType } from "@/lib/types";
import QuoteForm from "./QuoteForm";
import QuoteFormSupply from "./QuoteFormSupply";
import QuoteTypePicker from "./QuoteTypePicker";

const OFFER_TYPES: QuoteOfferType[] = ["quotation", "technical", "budgetary"];

export default async function NewQuotationPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const { type } = await searchParams;

  if (!type) return <QuoteTypePicker />;

  const data = await getQuoteFormData();

  if (type === "supply") {
    return <QuoteFormSupply accounts={data.accounts} contacts={data.contacts} />;
  }

  const offerType: QuoteOfferType = OFFER_TYPES.includes(type as QuoteOfferType)
    ? (type as QuoteOfferType)
    : "quotation";

  return (
    <QuoteForm
      {...data}
      offerType={offerType}
    />
  );
}

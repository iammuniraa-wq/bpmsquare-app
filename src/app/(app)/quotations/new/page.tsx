import { getQuoteFormData } from "@/lib/data";
import { getTenant } from "@/lib/tenant";
import { QUOTE_TYPES } from "@/lib/constants";
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

  if (!type) {
    const tenant = await getTenant();
    const vis = tenant?.config?.quote_type_visibility ?? {};
    // A type is enabled if the visibility map either has no entry for it (default on) or it's true
    const enabledTypes = QUOTE_TYPES
      .filter((qt) => qt.id in vis ? vis[qt.id as keyof typeof vis] !== false : true)
      .map((qt) => qt.id);
    return <QuoteTypePicker enabledTypes={enabledTypes} />;
  }

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

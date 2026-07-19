import { notFound, redirect } from "next/navigation";
import { getQuote, getQuoteFormData } from "@/lib/data";
import { getTenant } from "@/lib/tenant";
import { ROUTES, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import type { QuoteOfferType } from "@/lib/types";
import QuoteForm, { type EditQuoteData } from "../../new/QuoteForm";

export default async function EditQuotationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [data, formData, tenant] = await Promise.all([getQuote(id), getQuoteFormData(), getTenant()]);
  if (!data) notFound();

  const { quote, lines } = data;

  // Supply-type quotes use a different create form (QuoteFormSupply) that this
  // edit page doesn't cover yet — send those back to the detail page, where the
  // existing edit modal still handles them.
  if (quote.type === "supply") redirect(ROUTES.quotation(id));

  const quoteStatuses: QuoteStatusDef[] =
    (tenant?.config as { quote_statuses?: QuoteStatusDef[] })?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;
  const currentDef = quoteStatuses.find((s) => s.value === quote.status);
  // Terminal-status quotes (sent/approved) are locked — editing them means creating
  // a new revision instead, which only the detail page's "Create new version" flow does.
  if (currentDef?.is_terminal) redirect(ROUTES.quotation(id));

  const editQuote: EditQuoteData = { quote: quote as EditQuoteData["quote"], lines };

  return (
    <QuoteForm
      {...formData}
      offerType={quote.type as QuoteOfferType}
      editQuote={editQuote}
    />
  );
}

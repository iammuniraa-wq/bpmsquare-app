// The explanations the estimate working page keeps behind an "i" (bpmsquarecore 6b). One place, so a test holds every text to the
// InfoTip limit: two sentences, 160 characters. The page never prints these as running text.

export const ESTIMATE_TIPS = {
  page: "Start from the customer's email or fill in the details. Nothing is saved until you press Create quote or Save as draft.",
  pageTender: "Nothing is saved until you press Save as draft. The tender's Costing tab then prices the BOQ from this estimate.",
  customer: "Who the estimate is for. Choose an account and contact, or read them from the customer's email.",
  customerTender: "Taken from the tender, so there is nothing to choose again. Open it only to change the contact.",
  about: "Change any number and the model and the price follow straight away.",
  name: "Names the estimate, so it can be found later.",
  margin: "Added to the cost to give the price. The customer only sees the price.",
  price: "Each bar is one line of the quote as a share of the price before VAT. Costs and margin are under How the price is built.",
  createQuote: "Creates a quote for the customer with one line per section. Unit costs and margin are never shown to the customer.",
  needsSave: "Available once the estimate is saved.",
  exportScope: "Physical items only, or every line including labour, transport and overhead.",
} as const;

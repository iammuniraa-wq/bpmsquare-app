// The explanations the Costing tab keeps behind an "i" (bpmsquarecore 6b). One place, so a test (costing.test.ts) holds every text to the
// InfoTip limit: two sentences, 160 characters. The screens never print these as running text.

export const COSTING_TIPS = {
  tab: "Everything that gives your BOQ rows a cost: estimates you build and prices suppliers quote. Each line shows the rows it prices.",
  rowsPriced: "BOQ rows that have a rate. A rate comes from an estimate, an awarded supplier price, a past project or the client's own rate.",
  needCost: "BOQ rows with no rate yet. Open them in the Bill of quantities, or ask suppliers and build an estimate here.",
  rfqsOut: "RFQs sent to suppliers that can still be answered or awarded.",
  repliesIn: "Suppliers who have answered an RFQ that is still open.",
  newRfq: "Pick BOQ rows, suppliers and a reply date. One form for every RFQ, wherever you start it; the customer and your prices are never shown to suppliers.",
  newEstimate: "Starts an estimate from a template and keeps it on this tender. Costs stay internal; the client never sees them.",
  total: "An estimate shows its total cost. An RFQ shows the awarded cost of its lines, or the lowest valid price while nothing is awarded.",
  priceRows: "Gives BOQ rows their cost from this estimate, by matching wording or by spreading one part over the rows you tick. You confirm before anything is saved.",
  compare: "Suppliers side by side for each line. The lowest valid price is marked; an expired or stale answer is marked in amber.",
  award: "Stores the supplier's price as the row's cost, adds the markup and sets the price source to the RFQ. Awarding happens only here.",
  markup: "Added to the supplier's cost to give the rate: cost 100 with 15 percent is 115. It starts from your workspace default and is never exported.",
  reason: "Say why you chose a price that is not the lowest valid one. It stays with the award and in the RFQ's history.",
  fx: "The supplier quoted in another currency. Type the rate to your currency so the comparison and the cost are in one currency.",
  awardedUnpriced: "These lines were awarded but their BOQ rows do not carry the price yet. Price them to write cost, markup and source.",
  defaultMarkup: "The markup an award adds to a supplier's cost when you do not type another. Cost 100 with 15 percent gives a rate of 115.",
} as const;

export type CostingTipKey = keyof typeof COSTING_TIPS;

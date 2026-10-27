// The explanations the RFQ comparison and award screens keep behind an "i" (bpmsquarecore 6b). One place, so a test (tips.test.ts)
// holds every text to the InfoTip limit: two sentences, 160 characters. The screens never print these as running text.

export const RFQ_TIPS = {
  compare: "One column per supplier, one row per line. Blue is the lowest valid price on a line; amber is an expired or stale answer.",
  lowest: "The lowest price among answers that are still valid, after the exchange rate. An expired or stale answer is never called the lowest.",
  stale: "An answer with no validity date is stale after the number of days set in Settings, RFQ. Stale and expired prices are shown but never used as the benchmark.",
  coverage: "How many of the RFQ's lines this supplier quoted. The total adds only those lines, so compare totals between suppliers who cover the same lines.",
  waiting: "This supplier has not answered yet. The date is the next automatic reminder; overdue means the reminders are used up and it is time to call.",
  award: "Awarding records who chose the supplier and when. The price becomes the confirmed cost for a catalog product and is saved on the product.",
  reason: "Needed whenever the chosen price is not the lowest valid one on the line. It is kept with the award and shown on the RFQ.",
  awardAll: "Awards every line this supplier quoted. One reason covers all lines that are not the lowest valid price.",
  replace: "This line already has an award. Replacing it keeps the earlier decision in the history.",
  deal: "Writes each awarded price onto the deal line that asked for it, as the line's rate. It is the supplier's cost, so add your margin on the deal.",
  fx: "The supplier quoted in another currency. Enter today's rate so the price can be compared with the others.",
  saveFirst: "The request is made from the saved lines. Save the lines, then ask suppliers for their prices.",
  tenderRfq: "Pick the lines and the suppliers to ask; one supplier is enough. Replies come back into the RFQ for comparison.",
  approvedList: "Only the suppliers on this client's approved list can be asked. A client with no list can be asked any supplier.",
  type: "Pick vendors or subcontractors to narrow the list. Suppliers without a type show under All.",
} as const;

export type RfqTipKey = keyof typeof RFQ_TIPS;

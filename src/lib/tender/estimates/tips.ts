// The explanations behind the "i" on the estimate screens of a tender (GCC tender deals, slice 3c-1). Each is held to the shared limit
// (two sentences, 160 characters) by test, so no screen prints running text; the screens carry labels, numbers and actions only.

export const ESTIMATE_TIPS = {
  tab: "Estimates made for this tender. Price BOQ lines from them, then raise an RFQ for the costs you do not have yet.",
  newEstimate: "Starts an estimate from a template and keeps it on this tender. Costs stay internal; the client never sees them.",
  rowCost: "The estimate's total cost and the price it would quote. Both are internal.",
  priceFromEstimate: "Pick an estimate and the part of it that prices this line: the whole estimate, one of its lines or a WBS item.",
  basisTotal: "Spreads the part's cost, times your share, over this line's quantity. Use it when the estimate covers the whole line.",
  basisPerUnit: "Takes the estimate line's own cost per unit, times your share. Use it when the estimate line is priced per the same unit.",
  share: "The percent of that part of the estimate given to this line. All lines sharing a part together take at most 100 percent.",
  buildUp: "Starts an estimate from a template with this line's quantity filled in. Come back and the line is priced from its total divided by the quantity.",
  buildUpWaiting: "The estimate is made but the line is not priced yet. Open it, finish the costs, then use its total.",
  allocate: "Spreads a whole-scope estimate over the BOQ lines it covers, by matching wording or by each line's share of the BOQ. You confirm before anything is saved.",
  allocateMatch: "Each BOQ line takes the estimate line that reads most like it. Lines that take the same estimate line share its cost by amount or quantity.",
  allocateSpread: "One part of the estimate is spread over the BOQ lines you tick, in proportion to their amount or quantity.",
  unallocated: "The part of the estimate's cost not given to any BOQ line yet. Nothing is lost: it stays here until you allocate it.",
  stale: "The estimate was saved after this line was priced from it. Re-price to pick up the new cost; a bid already submitted is never changed for you.",
  review: "A supplier price was awarded and this line was re-priced from it. Look at the new rate, then mark it reviewed.",
  reviewLocked: "A supplier price was awarded after the bid went in, so the rate was left alone. Re-price on purpose if you revise the bid.",
  missing: "Estimate lines with no cost, or a cost older than your RFQ price validity. Ask suppliers about them in one RFQ, to as many suppliers as you like.",
  missingRfq: "Opens the RFQ form with these lines. When you award a line, the supplier's price goes into the estimate and the BOQ lines priced from it.",
  costForBoq: "The saved estimate's cost lines, overhead included, before margin and VAT. A BOQ line takes its share divided by its quantity, plus its own markup.",
  cost: "The estimate cost behind this rate. It is internal and never in the priced Excel, the answer sheet or a bid version.",
  unlink: "Removes the link. The line keeps its rate and counts as a manual rate until you price it again.",
  tenderStrip: "This estimate belongs to a tender. Its totals can price the tender's BOQ lines.",
} as const;

export type EstimateTipKey = keyof typeof ESTIMATE_TIPS;

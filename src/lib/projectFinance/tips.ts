// The explanations the cost and profitability screens keep behind an "i" (bpmsquarecore 6b). One place, so tips.test.ts holds every text to
// the InfoTip limit: two sentences, 160 characters. The screens never print these as running text.

export const PF_TIPS = {
  health: "Three lights for the project: margin, cash and delivery. Each is a word as well as a colour, and a light with nothing to measure says so.",
  marginLight: "At risk when the forecast margin is below zero or well under the plan. Watch when it is under your margin floor or slipping.",
  cashLight: "At risk when a billing milestone is long overdue, Watch when one is behind. Needs the invoices to be known.",
  deliveryLight: "At risk when too much of what was planned for delivery by today is late. Needs the ERP delivery read-back.",
  baselineMargin: "Margin at the first approved budget: the contract value before any client change, less the first approved budget.",
  plannedMargin: "Contract value less the approved budget. While some budget lines have no cost yet it shows the margin of the costed lines only, and says so.",
  forecastMargin: "Contract value less the forecast cost, as a percent of the contract value. The forecast cost is posted cost, open commitments and the estimate to go.",
  costToComplete: "What is still to be spent: open commitments plus the estimate to go.",
  marginAtRisk: "How far the forecast cost goes past the approved budget, in money. Nothing when the forecast is within the budget.",
  forecastCost: "Posted cost plus open commitments plus the estimate to go. It needs the ERP cost read-back, so it stays blank until that is connected.",
  actual: "Cost already posted to the project in the ERP, plus approved site expenses the ERP has not posted yet.",
  committed: "Open orders and subcontracts not yet invoiced, as the ERP reports them. Different from Awarded, which is what Buy-out has awarded.",
  awarded: "What the awarded buy-out packages total. It is not the ERP's committed cost, which needs the ERP read-back.",
  buyoutSaving: "The budget of the awarded packages less what they were awarded for. A negative saving means the awards cost more than the budget.",
  etg: "Your estimate of what is still to be spent in this row. Leave it empty and the budget is assumed to hold.",
  etgAssumed: "Rows with no estimate typed assume the budget holds: whatever is not yet spent or committed. This share of the forecast is a guess, not a fact.",
  firm: "How much of the forecast is already spent or committed, so no longer an estimate.",
  bridge: "How the margin moved from the baseline to the forecast, one step at a time. Execution and the forecast need the ERP cost.",
  notConnected: "This figure comes from the ERP cost read-back, which is not connected yet. It stays blank rather than showing 0.",
  scheduled: "The billing milestones due on or before today, added up. Real from the plan alone.",
  behindBilling: "Milestones due on or before today with no issued invoice, added up. A draft invoice does not count as billed.",
  cash: "The billing plan against what has been invoiced and received. Invoiced and received need the invoices to be known.",
  pending: "Client changes waiting for approval. They are shown beside the revenue step and are not counted in any figure.",
  visibility: "Who sees cost and margin. Granted means admins, people given Project cost and margin, and a project's own manager.",
  thresholds: "The numbers behind the lights. Margin drop in points, billing days behind, and the share of planned delivery that is late.",
  portfolio: "The lights of your active projects, and the five that need the most attention. Projects without an approved budget are left out.",
} as const;

export type PfTipKey = keyof typeof PF_TIPS;

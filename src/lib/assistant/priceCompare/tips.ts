// The explanations the price cards keep behind an "i" (bpmsquarecore.md 6b): at most two short sentences each, held to the InfoTip limit by a test.

export const PRICE_TIPS = {
  score: "Price 60: how near its prices are to the lowest on the lines it quoted. Completeness 20, validity 10, lead time 10; no lead time counts half.",
  basis: "Totals add each supplier's own quoted lines. Like for like uses only the lines every supplier quoted, so a partial quote is not unfairly cheap.",
  markup: "Leave it blank to use each BOQ row's own markup, else the workspace default. The rate is the cost plus the markup.",
  reason: "A price that is not the lowest valid one needs a reason, kept with the award. At least three characters.",
} as const;

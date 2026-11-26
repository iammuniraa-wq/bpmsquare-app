// The explanations the competitor card keeps behind an "i" (bpmsquarecore 6b). One place, so a test holds every text to the InfoTip limit:
// two sentences, 160 characters. The card never prints them as running text.

export const COMPETITOR_CARD_TIPS = {
  ladder: "Each row is a margin you could bid at, with the chance of winning it. Chances come from your own past bids once five have a recorded margin.",
  expected: "Expected profit is the chance of winning times the profit at that margin. With no recorded cost it is shown per 100 of cost.",
  history: "Counts decided tenders of this workspace only. A tender with no recorded cost or winning price counts for less.",
} as const;

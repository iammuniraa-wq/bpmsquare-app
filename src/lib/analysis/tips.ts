// The explanations the company analysis card keeps behind an "i" (bpmsquarecore 6b). One place, so a test can hold every
// text to the InfoTip limit (two sentences, 160 characters). The card prints none of these.

export const ANALYSIS_TIPS = {
  verdict: "A fixed set of rules decides this from Fit and Timing. The AI only words the sentence.",
  fit: "How well this company matches what you sell: its industry, where it is, how big it is and what is said about your subjects.",
  timing: "For an account this is its Buying signals stage. For any other company it comes from public news only.",
  doing: "Dated items found on the public web. Anything we could not tie to this company is left out.",
  inSystem: "Read from your own records, only the parts you are allowed to see.",
  refresh: "A saved analysis is reused for seven days. A fresh one can be run once an hour.",
  card360: "The saved answer for this company: is it worth following up, and what it has been doing lately. Open the AI slider to refresh it.",
  limit: "Each workspace has a daily limit on web analyses. A saved card still opens.",
} as const;

export const ANALYSIS_EMPTY = {
  littleInfo: "Little public information found",
  needsWeb: "Needs web research",
  notInSystem: "Not in your system yet",
  pending: "Not saved: database update pending",
} as const;

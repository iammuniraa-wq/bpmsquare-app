// The explanations the Supplier check keeps behind an "i" (bpmsquarecore 6b). One place, so a test holds every text to the InfoTip limit:
// two sentences, 160 characters. The screens never print these as running text.

export const CHECK_TIPS = {
  overall: "A risk indicator built from your own records and, if you agree, public web pages. It is not a legal finding.",
  verdict: "Looks genuine needs evidence. Could not verify means nothing confirms the company yet, which is not a finding against it.",
  rating: "Worked out from your own RFQs with this supplier in the last 24 months. It needs at least 3 RFQs.",
  formatOnly: "Format only means the number was checked for its length and pattern. It was not looked up in the government registry.",
  web: "Public web pages are searched for the company's age, clients, certifications and news. Every statement shows the page it came from.",
  reputation: "What cited pages report, in their own terms. Nothing here is our finding, and a page may be out of date.",
  sharpen: "Each line is something missing that, once added or done, makes the result more reliable.",
  history: "Earlier checks of this supplier, newest first. Each one is kept as it was.",
  awardWarning: "Your last saved Supplier check marked this supplier. You can still award; your reason is kept in the change history.",
  save: "Keeps this check on the supplier's record, where the list and the RFQ screens read it. The assistant never saves without your press.",
} as const;

export type CheckTipKey = keyof typeof CHECK_TIPS;

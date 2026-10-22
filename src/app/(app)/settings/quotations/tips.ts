// The explanations the Quotations screen keeps behind an "i" (bpmsquarecore 6b). One place so a test holds every text
// to the InfoTip limit (two sentences, 160 characters). The screen never prints these as running text.

export const QUOTATION_TIPS = {
  page: "The stages a quotation moves through, the offer types people can pick, saved texts and emails, and what prints for equipment.",
  statuses: "The stages a quotation moves through, in order. New quotes start at the one marked Starts here.",
  closed: "A closed status locks the quote and asks for an outcome, won or lost. At least one status must be closed.",
  offerTypes: "Hidden types do not appear in the New Quotation picker. Quotes already made keep their type.",
  templates: "Saved texts people insert while writing a quotation, and the emails they pick when sending one.",
  defaultEmail: "Sending uses the default email of its kind. Without one, a built-in text is used.",
  print: "Equipment fields that print in the Equipment Details section of a quote. The section is left out when none are chosen.",
} as const;

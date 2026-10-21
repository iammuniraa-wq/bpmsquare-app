// What the form builder's "After sending" group keeps behind an "i" (docs/design/ux-simplification.md rule 6b).
// One place so a test holds every text to the InfoTip limit (two sentences, 160 characters).

export const FORM_TIPS = {
  thankYou: "A confirmation to the person about their own answer. It is sent whether or not they ticked the consent box.",
  thankYouWords: "These words go under a short greeting with the person's first name. Plain text only.",
  confirm: "The tick counts only after the person presses the link in the email, which works for 7 days. On by default for the European Union, off elsewhere.",
  confirmNeeds: "The email with the link is sent even when the thank-you words are off, because without it nobody could confirm.",
  notify: "One person of your workspace gets a short email with each new answer.",
  notifyWho: "Only people who belong to this workspace can be chosen.",
} as const;

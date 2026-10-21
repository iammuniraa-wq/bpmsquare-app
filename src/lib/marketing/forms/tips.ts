// The explanations the form builder keeps behind an "i" (docs/design/ux-simplification.md §3 row 5).
// One place, so a test can hold every text to the InfoTip limit (two sentences, 160 characters). The screen never
// prints these; it passes them to InfoTip. "Consent topic" is what a person agreed to hear about (§3b L1).

export const FORM_TIPS = {
  basics: "Names and words. The name is only for your team; the heading is what visitors read.",
  name: "Only your team sees this name. Visitors never do.",
  intro: "One or two sentences under the heading.",
  fields: "What the visitor is asked. Email is always asked, so a person can be found again and their consent attached.",
  consent: "The words people agree to, and the consent topics they agree to hear about. The box is never pre-ticked.",
  consentWords: "These exact words, the time, this form and a hashed network address are saved with every box that is ticked.",
  consentTopics: "Pick none to cover every consent topic. Say in your words above what you will send.",
  consentRequired: "Leave it off for a contact form, so people can ask a question without agreeing to emails. An unticked box records no consent.",
  after: "What the visitor sees once the form is sent.",
  redirect: "Only an https address on your own domain works. Anything after a ? is dropped.",
  share: "Switch it on, then use the hosted address or put the form on your website.",
  status: "Only a Live form can be opened or sent by a visitor. Save after changing it.",
  embed: "Paste it where the form should appear. It sits in its own frame, so your site's styles cannot break it.",
  answers: "The latest 25 answers, kept 180 days.",
} as const;

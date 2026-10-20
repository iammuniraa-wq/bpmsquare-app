// The explanations the Newsletter Studio keeps behind an "i" (docs/design/ux-simplification.md §3 row 1).
// One place, so a test can hold every text to the InfoTip limit (two sentences, 160 characters) and the how-to
// guide can quote them. The screen never prints these; it passes them to InfoTip.

export const NEWSLETTER_TIPS = {
  start: "Name it, choose the category and consent topic, then begin from one line for AI, a design, or a blank page. English comes first.",
  name: "Only your team sees this name. Recipients never do.",
  consentTopic: "Only people who agreed to hear about this topic receive it. It is checked for each person when you send.",
  brand: "Logo, colours and fonts come from Settings, Brand kit, and are used by every design. An admin changes them there.",
  blocks: "The pieces of the email: click one to edit its words, drag to reorder. Header and footer stay, as they carry your brand and the unsubscribe line.",
  link: "Only web, email and phone links are kept. Clicks are counted; the address stays yours.",
  picture: "Pictures are kept in your own workspace. A picture from anywhere else is never used.",
  rewrite: "AI suggests new words; keep them or type your own. {{account_name}} is replaced for each person.",
  languages: "English is written first. Each person gets their own language if the email has it: the contact's, then the account's, then English.",
  addLanguage: "AI translates every block and keeps product names and prices. Lines it was unsure about show \"Check this\" until you accept or edit them.",
  health: "Fixed rules that run every time, never opinions or a score. Each amber item says what to change.",
  preview: "Built exactly as email programs show it: tables, plain fonts, no scripts. Phone and Dark show a small screen or inverted colours.",
  preheader: "The short line an inbox shows after the subject.",
  html: "Generated from the blocks. Every text is escaped, links are checked, and nothing you type is sent as HTML.",
} as const;

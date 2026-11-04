// The explanations the New campaign screen keeps behind an "i" (docs/design/settings-simplification-marketing.md,
// batch M1). One place, so a test can hold every text to the InfoTip limit (two sentences, 160 characters). The
// screens never print these; they pass them to Field and Card.

export const COMPOSE_TIPS = {
  subject: "Use {{account_name}} and {{company_name}}; each is replaced for every recipient.",
  newsletter: "This campaign sends a newsletter you designed. Each person gets their own language, and the usual consent and unsubscribe rules apply.",
  languages: "Only languages with every line checked can be ticked. Tick more once they are ready.",
  fallback: "A person's preferred language is used when it is ticked, then their company's. Otherwise this one.",
  audience: "Pick everyone we can email, a saved audience, or change it here. Only people with consent for the topic are emailed.",
  consentChip: "Only people who agreed to this topic are emailed. Topics and rules are set once, in Settings.",
  extraEmails: "Only a contact who agreed to this topic is emailed. Any other address is listed as left out, with a link to create the contact.",
  audienceCount: "This is the count the send will use: the same checks for address, contact and consent, run without sending.",
  consentTopic: "People agree to consent topics separately. Only people who agreed to this one are emailed.",
} as const;

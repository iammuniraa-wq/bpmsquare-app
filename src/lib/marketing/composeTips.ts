// The explanations the New campaign screen keeps behind an "i" (docs/design/settings-simplification-marketing.md,
// batch M1). One place, so a test can hold every text to the InfoTip limit (two sentences, 160 characters). The
// screens never print these; they pass them to Field and Card.

export const COMPOSE_TIPS = {
  subject: "Use {{account_name}} and {{company_name}}; each is replaced for every recipient.",
  newsletter: "This campaign sends a newsletter you designed. Each person gets their own language, and the usual consent and unsubscribe rules apply.",
  languages: "Only languages with every line checked can be ticked. Tick more once they are ready.",
  fallback: "A person's preferred language is used when it is ticked, then their company's. Otherwise this one.",
  consentTopic: "People agree to consent topics separately. Only people who agreed to this one are emailed.",
} as const;

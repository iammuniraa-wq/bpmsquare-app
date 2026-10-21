// The explanations the event form keeps behind an "i" (docs/design/settings-simplification-marketing.md, batch M1).
// One place, so a test can hold every text to the InfoTip limit (two sentences, 160 characters). The form never
// prints these; it passes them to Field. The kind and status explanations live beside their lists in rules.ts.

export const EVENT_TIPS = {
  capacity: "Registration is never refused, but the page shows when you are over.",
  venue: "Where people go. Leave empty for a webinar.",
  link: "The join link for a webinar, or a map link. A full https address.",
  owner: "Who runs the event. Each company's own owner, for the follow-up, comes from Coverage.",
  about: "A line or two for your team. Plain text.",
  registrationForm: "People who fill in this form while registration is open are registered, with consent recorded as the form says. One form serves one running event.",
  journey: "A journey you already built and turned on. Starting the follow-up puts the chosen people through it; its own rules decide what is sent.",
  followUpFor: "Who the follow-up starts for.",
} as const;

/** The date is read in the workspace's time zone; the zone is a name with underscores, shown with spaces. */
export const eventDateTip = (timezone: string): string => `In ${timezone.replace(/_/g, " ")} time.`;

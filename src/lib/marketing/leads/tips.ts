// The explanations the lead score screens keep behind an "i" (docs/design/ux-simplification.md §3 row 12). One place,
// so a test can hold every text to the InfoTip limit (two sentences, 160 characters).

export const LEAD_SCORE_TIPS = {
  score: "A score is worked out from what each person did, so it is never a guess. Open a lead to see every point.",
  person: "No person is named, so the score uses everyone at the company.",
} as const;

/** "Why 72?": which rules produced the number. */
export const whyScoreTip = (rulesVersion: number | string): string =>
  `Points come from what this person did and who they are, by scoring rules version ${rulesVersion}. Change the rules in Settings, Marketing, Scoring.`;

// What the Hand-over screen keeps behind an "i" (docs/design/ux-simplification.md rule 6b). One place so a
// test holds every text to the InfoTip limit (two sentences, 160 characters).

export const HANDOVER_TIPS = {
  autoCreate: "When someone with no open lead becomes Warm, a lead is made for them. It is checked every 15 minutes, never when a page opens.",
  responseTime: "How many working days a salesperson has to pick up a lead once it is Ready for sales. After that it shows as overdue.",
  daysOff: "These days do not count towards the response time. Gulf workspaces usually tick Friday and Saturday.",
  fallback: "Used when no team covers the company. The people take new leads in turn; with nobody here, the oldest admin has them.",
  overdue: "When a lead is overdue, these people get a message in the Nova inbox. Each lead is announced once.",
  overdueOwner: "The person who owns the lead.",
  overdueLead: "The lead of the team that covers the company. Needs Coverage.",
  overdueLeadOff: "The lead of the team that covers the company. Coverage is off here, so nobody can be found.",
} as const;

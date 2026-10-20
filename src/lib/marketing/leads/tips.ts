// The explanations the lead score screens keep behind an "i" (docs/design/ux-simplification.md §3 row 12). One place,
// so a test can hold every text to the InfoTip limit (two sentences, 160 characters).

export const LEAD_SCORE_TIPS = {
  score: "A score is worked out from what each person did, so it is never a guess. Open a lead to see every point.",
  person: "No person is named, so the score uses everyone at the company.",
} as const;

/** "Why 72?": which rules produced the number. */
export const whyScoreTip = (rulesVersion: number | string): string =>
  `Points come from what this person did and who they are, by scoring rules version ${rulesVersion}. Change the rules in Settings, Marketing, Scoring.`;

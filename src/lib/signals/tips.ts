// The explanations the Buying signals screen keeps behind an "i" (docs/design/ux-simplification.md §3 row 6).
// One place, so a test can hold every text to the InfoTip limit (two sentences, 160 characters). The screen never
// prints these. "Interest" is the subject you sell; "consent topic" is what a person agreed to hear about (§3b L1).

export const SIGNAL_TIPS = {
  list: "Scored from your own quotes, cases and campaigns. The highest score is at the top.",
  filters: "Narrow the list by stage, interest, owner or account name.",
  stage: "How close an account looks to buying, from its own actions. Silent has nothing recent; Looking shows interest; Comparing asked us; Deciding is very engaged.",
  interest: "Only accounts that engaged with a subject you sell. Interests come from tagged newsletter links.",
  owner: "The owner comes from your Coverage rules.",
  worked: "A fixed rubric: older signals count for less, each group has a limit, and nothing here is guessed by AI.",
  timeline: "What moved the score, newest first.",
  didItWork: "Pick a campaign or newsletter send. We compare each recipient's stage in the 14 days before and after.",
  interests: "The subjects you sell, such as Precast. A click on a newsletter link tagged with one counts for more than an untagged click.",
  keywords: "Separated by commas. Kept for the news and tender sources that come later.",
} as const;

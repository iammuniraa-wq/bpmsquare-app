// The explanations Settings -> Marketing -> Scoring keeps behind an "i" (docs/design/ux-simplification.md §3 row 3).
// One place, so a test can hold every text to the InfoTip limit (two sentences, 160 characters). The screen never
// prints these.

export const SCORING_TIPS = {
  intro: "A lead's score is added up from these rules, so anyone can see exactly why it is what it is. Nothing here is decided by AI.",
  behaviour: "Each time someone does one of these, their lead earns or loses points. Points fade as the action gets older.",
  profile: "These add points for the kind of company or person, however recently they were in touch. They never fade.",
  lines: "A lead below the first line is Cold, from the first line it is Warm, and from the second it is Hot.",
  label: "The words a salesperson sees next to the points.",
  points: "How much it is worth each time. Use a minus number to take points away.",
  fades: "After this many days it is worth half. Leave empty if it should never fade.",
  cap: "Stops one busy afternoon from running up the score. Leave empty for no limit.",
  profilePoints: "Added once when the lead matches.",
  match: "Use “any one” to list several countries or roles.",
  warm: "A lead at or above this score is showing real interest.",
  hot: "At or above this score a salesperson should call.",
  lookback: "Anything older than this is ignored, whatever its points.",
  tryIt: "Pretend a lead did these things and see what the rules would make of it. Nothing is saved or sent.",
  accountType: "For example oem, direct or prospect.",
  country: "For example Saudi Arabia.",
  role: "For example Purchasing Manager.",
  serviceContract: "An active annual maintenance contract.",
} as const;

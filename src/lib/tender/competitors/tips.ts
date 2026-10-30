// The explanations the Competitors tab keeps behind an "i" (bpmsquarecore 6b). One place, so a test (competitors.test.ts) holds every
// text to the InfoTip limit: two sentences, 160 characters. The screens never print these as running text.

export const COMPETITOR_TIPS = {
  tab: "The companies you expect to bid against on this tender. Keep what you know about each one here so the team prices with them in mind.",
  expectedPrice: "Read from our side: Below us means we expect them to quote less than we do. It is your judgement, not a recorded figure.",
  strengths: "What they are good at: price, local presence, past work for this client, delivery speed.",
  winner: "Mark the company that won. It is saved as who won on the deal, so Lost tenders and reports agree.",
  insights: "Searches the public web for this company and shows what it is doing. It uses part of your AI allowance; a saved card shows again free.",
  status: "Proposed came from market research and is not saved as a competitor until you accept it. Added by you is yours.",
  evidence: "Each fact links to the page it came from. Nothing without a source is shown; not found means no page stated it.",
  suggest: "Searches the public web for likely bidders and proposes them with a source for every fact. It uses part of your AI allowance; nothing is saved until you accept.",
  assumes: "What the research was told about this tender. It is context for you; it is not saved as a tender field.",
  cheaper: "How many competitors you expect to quote below you. Only those with an expected price count.",
  whoWon: "Pick a competitor from this tender, or Someone else to add a new one. The company you pick is marked as the winner.",
} as const;

export type CompetitorTipKey = keyof typeof COMPETITOR_TIPS;

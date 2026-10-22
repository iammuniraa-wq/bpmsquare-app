// The explanations the journey builder keeps behind an "i" (docs/design/ux-simplification.md §3 row 2). One place,
// so a test can hold every text to the InfoTip limit (two sentences, 160 characters). The screen never prints these.

export const JOURNEY_TIPS = {
  start: "The name only your team sees, and a ready-made journey that replaces the steps.",
  name: "Only your team sees this name.",
  template: "A ready-made journey you can change. Picking one replaces the steps in Build.",
  when: "The moment a person enters. It can come from Sales, Service or a form, not only from marketing.",
  condition: "An extra check before anyone enters. Consent is always checked again at each send, whatever you pick.",
  lookback: "When you go live, people from events this recent also enter. 0 means only new events.",
  rules: "Whether a person can go through again, and the limits that protect your customers.",
  reentry: "Each person goes through this journey once.",
  onePerCompany: "If two people at one company are on the quote, only one gets the journey.",
  entry: "Counted by the same rules the runner uses, from what is on screen, saved or not.",
  steps: "Each line is a step. The sentence under it says when it fires; the guards chip says what can hold or skip it.",
  languages: "Each person gets their own language if the newsletter has it, otherwise English. Add languages in the Newsletter Studio.",
  try: "Shows the exact path and dates this person would get, with the reason at every turn. Nothing is sent.",
  pick: "Uses what is on screen, saved or not.",
  running: "Live counts from the run log, not a guess. Click a reason to see the people.",
  definition: "What the steps compile to, for your IT team. The runner works through it every five minutes.",
} as const;

/** Dynamic tips: built from the workspace's own settings, held to the same limit. */
export const inTroubleTip = (caseDays: number): string => `No newsletter while a case has been open over ${caseDays} days or an invoice is overdue.`;
export const limitsTip = (timezone: string): string => `Set for the whole workspace (${timezone}). Messages wait for the next allowed time; they are never dropped.`;

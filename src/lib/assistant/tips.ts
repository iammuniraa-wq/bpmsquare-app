// The explanations the assistant dock keeps behind an "i" (bpmsquarecore.md 6b). One place, so a test can hold every
// text to the InfoTip limit (two sentences, 160 characters). The dock never prints these as running text.
//
// Owner decision 2026-10-22: the dock carries at most three. Labels that explain themselves (the open record, a
// suggestion, a guide step, a card, a briefing row) have none; errors and blockers stay visible text.

export const ASSISTANT_TIPS = {
  header: "Ask about your data in plain words, or say where you want to go. It reads live data you may see and cannot change anything.",
  usage: "Your workspace shares a monthly AI allowance across every AI feature. Suggestions and opening screens keep working when it runs out.",
  overBudget: "The monthly allowance is used up. Suggestions and opening screens still work; answers return next month or when the allowance is raised.",
  webConsent: "The assistant asks before it searches the web, and only about companies. Nothing from your records or contacts is sent.",
} as const;

/** How many "i" the dock may show at once: the header, the usage pill and the web-search question. */
export const DOCK_TIP_LIMIT = 3;

/** The usage pill's own explanation, with the figures in it. */
export function usageTip(percent: number, off: boolean): string {
  if (off) return "AI is switched off for this workspace. Suggestions and opening screens still work.";
  const left = Math.max(0, 100 - percent);
  return `This month's allowance is shared by every AI feature. ${left}% is left; suggestions and opening screens never use it.`;
}

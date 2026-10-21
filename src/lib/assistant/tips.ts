// The explanations the assistant dock keeps behind an "i" (bpmsquarecore.md 6b). One place, so a test can hold
// every text to the InfoTip limit (two sentences, 160 characters). The dock never prints these as running text.

export const ASSISTANT_TIPS = {
  header: "Ask about your data in plain words, or say where you want to go. It reads live data you may see and cannot change anything.",
  context: "The record you have open. It is used to answer without you naming it; only its reference and a short summary are read.",
  suggestions: "Next steps worked out from the record on screen by fixed rules, not by the AI. Each opens a screen or asks a question.",
  usage: "Your workspace shares a monthly AI allowance across every AI feature. Suggestions and opening screens keep working when it runs out.",
  overBudget: "The monthly allowance is used up. Suggestions and opening screens still work; answers return next month or when the allowance is raised.",
  draft: "Paste an email or message and get a drafted record to review. Nothing is created until you press Create.",
} as const;

/** The usage pill's own explanation, with the figures in it. */
export function usageTip(percent: number, off: boolean): string {
  if (off) return "AI is switched off for this workspace. Suggestions and opening screens still work.";
  const left = Math.max(0, 100 - percent);
  return `This month's allowance is shared by every AI feature. ${left}% is left; suggestions and opening screens never use it.`;
}

/** Why the context line is empty on a list page. */
export function listContextTip(noun: string): string {
  return `You are in the ${noun} list. Open a ${noun} and the assistant starts from it.`;
}

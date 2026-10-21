// Which model answers an ask, and what a call costs against the allowance. Pure, so the decision is tested.
//
// Two tiers, one decision per ask (never mid-loop: a model change inside a tool loop would drop the earlier
// turn's reasoning blocks and re-pay the whole prefix):
//   small -> plain reads and anything about where to go: one number, one short list, "how many", "open ...".
//   mid   -> multi-step answers: comparisons, trends, causes, anything that needs several queries chained.
// The models are the ones this repo already calls (src/lib/ai/*): `claude-opus-5` is what the dock has always
// used and stays the mid tier; `claude-opus-5-5` (the cheaper per-token model in use by structured.ts) is the small
// tier, run at low effort. Naming a smaller family is one environment variable, ASSISTANT_SMALL_MODEL, left to the
// owner (design doc section 11, decision 2); nothing else in the code changes.

export const MID_MODEL = "claude-opus-5";
export const SMALL_MODEL_DEFAULT = "claude-opus-5-5";

export type ModelTier = "small" | "mid";

export function smallModel(): string {
  const fromEnv = typeof process !== "undefined" ? process.env.ASSISTANT_SMALL_MODEL?.trim() : "";
  return fromEnv || SMALL_MODEL_DEFAULT;
}

export function modelFor(tier: ModelTier): string {
  return tier === "mid" ? MID_MODEL : smallModel();
}

// Words that mean "work this out", not "look this up". Kept short and boring: a wrong guess costs one escalation
// (the person rephrases) or a few extra tokens, never a wrong number, because the numbers come from tools either way.
const MULTI_STEP = /\b(compare|comparison|versus|vs\.?|trend|over time|month by month|year over year|why|explain|reason|analy[sz]e|analysis|insights?|forecast|predict|correlat|recommend|what should|summari[sz]e|breakdown|break down|chart|graph|plot|top \d+|rank|and then|both|each of|per [a-z]+ and)\b/i;
const LONG_ASK = 220;

export type RouteInput = {
  question: string;
  /** Earlier turns: a follow-up to a multi-step answer stays on the mid tier. */
  history?: { role: "user" | "assistant"; text: string }[];
};

export function routeAsk(input: RouteInput): { tier: ModelTier; reason: string } {
  const q = input.question.trim();
  if (q.length > LONG_ASK) return { tier: "mid", reason: "long question" };
  if (MULTI_STEP.test(q)) return { tier: "mid", reason: "asks to compare, explain or chart" };
  const lastBot = [...(input.history ?? [])].reverse().find((t) => t.role === "assistant");
  if (lastBot && /\bchart\b|trend|compared|versus/i.test(lastBot.text) && q.length < 60) {
    return { tier: "mid", reason: "follow-up to a multi-step answer" };
  }
  return { tier: "small", reason: "plain read" };
}

export type ApiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/**
 * What a call counts for against the monthly allowance. The meter's unit is "tokens as billed": uncached input at
 * face value, cache writes at 1.25x and cache reads at 0.1x (the price ratios of prompt caching), output as is. So
 * the cached catalogue makes an ask cheaper on the allowance exactly as it does on the invoice.
 */
export function billedTokens(u: ApiUsage): { input: number; output: number } {
  const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const input = n(u.input_tokens) + Math.ceil(n(u.cache_creation_input_tokens) * 1.25) + Math.ceil(n(u.cache_read_input_tokens) * 0.1);
  return { input, output: n(u.output_tokens) };
}

/** The pill: whole percent of the allowance used, capped at 100. A budget of 0 reads as 100 (AI is off). */
export function usagePercent(used: number, budget: number): number {
  if (budget <= 0) return 100;
  return Math.min(100, Math.max(0, Math.floor((used / budget) * 100)));
}

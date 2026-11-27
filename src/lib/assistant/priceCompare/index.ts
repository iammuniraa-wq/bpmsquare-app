import "server-only";
import { runProposeAward } from "./award";
import { runPriceCheck } from "./check";
import { runCompare } from "./compare";
import type { PriceEnv } from "./env";
import { AWARD_TOOL, CHECK_TOOL, COMPARE_TOOL } from "./tools";
import type { PriceCard } from "./types";

export { AWARD_TOOL, CHECK_TOOL, COMPARE_TOOL, PRICE_COMPARE_PROMPT_RULE, PRICE_TOOL_NAMES, priceAccess, priceTools } from "./tools";
export type { PriceEnv } from "./env";
export type { PriceCard } from "./types";

export type PriceOutcome = { out: string; card?: PriceCard; say?: string };

/** One door for the three price tools: the name picks the function, and each function re-checks the caller's rights before reading anything. */
export async function runPriceTool(name: string, input: unknown, env: PriceEnv): Promise<PriceOutcome> {
  switch (name) {
    case COMPARE_TOOL: return runCompare(input, env);
    case AWARD_TOOL: return runProposeAward(input, env);
    case CHECK_TOOL: return runPriceCheck(input, env);
    default: return { out: `Error: unknown tool "${name}".` };
  }
}

/** The sentence beside a card when the model wrote none: the card itself carries everything else. */
export function priceIntro(card: PriceCard): string {
  if (card.kind === "compare") return card.comparison.recommendation ? `Here is the comparison for ${card.comparison.rfq.ref}.` : `Here are the prices on ${card.comparison.rfq.ref}.`;
  if (card.kind === "award") return card.blocked ? `${card.rfq.ref} cannot be awarded from here yet.` : `Check the card, then press the button to award ${card.rfq.ref}.`;
  return `Here are the lines of ${card.deal.ref} that differ most from your own history.`;
}

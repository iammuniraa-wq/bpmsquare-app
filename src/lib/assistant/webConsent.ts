import { sameQuery } from "./webQuery";

// The consent state machine for web research (docs/design/assistant-smarter.md section 2). Pure and client-safe: the
// server decides with decideWebSearch, the dock moves its chips with applyChoice, and both are tested.
//
// Consent is one search at a time: Yes on a chip runs exactly the query on that chip, once. The model never has the web
// by itself; it can only ask, and there is no standing permission for a chat (owner decision 2026-10-22).

export type WebAllow = "once";
export type WebChoice = "yes" | "no";

/** One research call per ask (it may search up to three times inside), and a ceiling per person per day. */
export const MAX_RESEARCH_PER_ASK = 1;
export const MAX_RESEARCH_PER_DAY = 20;
/** Added to the allowance for each search the provider ran, on top of the real tokens (design section 2). */
export const SEARCH_SURCHARGE_TOKENS = 5000;

/** How many of the latest turns count as "recent" for a web-derived answer: three exchanges. The dock reads it too. */
export const WEB_TAINT_WINDOW = 6;

export function parseAllowWeb(v: unknown): WebAllow | null {
  return v === "once" ? v : null;
}

export type WebAvailability = { enabled: true } | { enabled: false; reason: "flag_off" | "needs_assistant" | "policy" };

/**
 * Whether this workspace may use web research at all: the platform-admin flag, the AI assistant it hangs off, and the
 * workspace's own policy against external calls.
 */
export function webAvailability(
  features: Record<string, boolean | undefined>,
  config: { ai_assistant?: { block_external_calls?: boolean } } | null | undefined,
): WebAvailability {
  if (features.ai_assistant_web !== true) return { enabled: false, reason: "flag_off" };
  if (features.ai_assistant !== true) return { enabled: false, reason: "needs_assistant" };
  if (config?.ai_assistant?.block_external_calls === true) return { enabled: false, reason: "policy" };
  return { enabled: true };
}

export type WebDecision = { kind: "run" } | { kind: "ask" } | { kind: "refuse"; reason: string };

export function decideWebSearch(i: {
  enabled: boolean;
  allow: WebAllow | null;
  /** The query the person said yes to, sent back by the dock. */
  consentQuery: string | null;
  proposedQuery: string;
  researchedThisAsk: number;
}): WebDecision {
  if (!i.enabled) return { kind: "refuse", reason: "Web research is not switched on for this workspace." };
  if (i.researchedThisAsk >= MAX_RESEARCH_PER_ASK) return { kind: "refuse", reason: "One web search per question is the limit." };
  if (i.allow === "once" && i.consentQuery && sameQuery(i.consentQuery, i.proposedQuery)) return { kind: "run" };
  return { kind: "ask" };
}

// --- the dock side -------------------------------------------------------------------------------------------------

export type ConsentState = "pending" | "yes" | "no" | "skipped";

export type ChoiceOutcome = {
  state: ConsentState;
  /** Send the question again with this permission; null means send nothing. */
  allow: WebAllow | null;
};

export function applyChoice(choice: WebChoice): ChoiceOutcome {
  return choice === "yes" ? { state: "yes", allow: "once" } : { state: "no", allow: null };
}

/** A question typed while chips are still open leaves them unanswered: they close, nothing is searched. */
export const settleOnNewAsk = (s: ConsentState): ConsentState => (s === "pending" ? "skipped" : s);

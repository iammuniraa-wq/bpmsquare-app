import { sameQuery } from "./webQuery";

// The consent state machine for web research (docs/design/assistant-smarter.md section 2). Pure and client-safe: the
// server decides with decideWebSearch, the dock moves its chips with applyChoice, and both are tested.
//
// Consent is per chat and never stored for a person: "Always in this chat" lives in the dock's own state and is gone on
// a reload. The model never has the web by itself; it can only ask, and a search runs when the person has said yes to
// that exact query (once) or to this chat (always).

export type WebAllow = "once" | "chat";
export type WebChoice = "yes" | "no" | "always";

/** One research call per ask (it may search up to three times inside), and a ceiling per person per day. */
export const MAX_RESEARCH_PER_ASK = 1;
export const MAX_RESEARCH_PER_DAY = 20;
/** Added to the allowance for each search the provider ran, on top of the real tokens (design section 2). */
export const SEARCH_SURCHARGE_TOKENS = 5000;

export function parseAllowWeb(v: unknown): WebAllow | null {
  return v === "once" || v === "chat" ? v : null;
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
  if (i.allow === "chat") return { kind: "run" };
  if (i.allow === "once" && i.consentQuery && sameQuery(i.consentQuery, i.proposedQuery)) return { kind: "run" };
  return { kind: "ask" };
}

// --- the dock side -------------------------------------------------------------------------------------------------

export type ConsentState = "pending" | "yes" | "always" | "no" | "skipped";

export type ChoiceOutcome = {
  state: ConsentState;
  /** Send the question again with this permission; null means send nothing. */
  allow: WebAllow | null;
  /** The chat-wide switch after this choice. */
  chatMode: boolean;
};

export function applyChoice(choice: WebChoice, chatMode: boolean): ChoiceOutcome {
  if (choice === "yes") return { state: "yes", allow: "once", chatMode };
  if (choice === "always") return { state: "always", allow: "chat", chatMode: true };
  return { state: "no", allow: null, chatMode };
}

/** What a fresh question carries: the chat-wide permission, if the person gave it. */
export const allowForAsk = (chatMode: boolean): WebAllow | null => (chatMode ? "chat" : null);

/** A question typed while chips are still open leaves them unanswered: they close, nothing is searched. */
export const settleOnNewAsk = (s: ConsentState): ConsentState => (s === "pending" ? "skipped" : s);

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askStructuredMetered, AiError } from "@/lib/ai/structured";
import { buildFacts, factsHash, primaryLang, validateWording, wordingPrompt, WORDING_SCHEMA, type Wording } from "./phrase";
import type { Briefing } from "./types";

// Orchestrates the optional AI paragraph (docs/design/assistant-smarter.md WP8). The model call is metered under its own
// surface ("briefing"); a person gets one on the first open of the day and another only when the facts or the language
// changed, never more than DAILY_CALLS, counted from ai_usage_log so the cap holds even while the storage table
// (assistant_briefings) is pending. Every failure -- no key, over the allowance, a bad answer -- resolves to "no
// paragraph": the plain list is always the briefing.

export const BRIEFING_SURFACE = "briefing";
export const DAILY_CALLS = 3;

export type WordingResult = { wording: Wording | null; tokens: number };

export type WordingRequest = { briefing: Briefing; previous: Wording | null; lang: string | null; since: string };

export type WordingDeps = {
  /** Calls made today by this person under the briefing surface, and the tokens they cost. */
  usage: () => Promise<{ calls: number; tokens: number }>;
  phrase: (system: string, prompt: string) => Promise<unknown>;
};

export async function resolveWording(req: WordingRequest, deps: WordingDeps): Promise<WordingResult> {
  const facts = buildFacts(req.briefing);
  if (!facts) return { wording: null, tokens: 0 };
  const hash = factsHash(facts);
  const lang = primaryLang(req.lang);
  const current = req.previous && req.previous.facts === hash ? req.previous : null;
  if (current && current.lang === lang) return { wording: current, tokens: 0 };

  let used: { calls: number; tokens: number };
  try {
    used = await deps.usage();
  } catch {
    return { wording: current, tokens: 0 };
  }
  if (used.calls >= DAILY_CALLS) return { wording: current, tokens: used.tokens };

  try {
    const { system, prompt } = wordingPrompt(facts, lang);
    const out = await deps.phrase(system, prompt) as { paragraph?: unknown } | null;
    const paragraph = validateWording(out?.paragraph, facts, lang);
    const tokens = await deps.usage().then((u) => u.tokens, () => used.tokens);
    return { wording: paragraph ? { paragraph, lang, facts: hash } : current, tokens };
  } catch (e) {
    if (!(e instanceof AiError)) console.error("Briefing wording failed:", e);
    return { wording: current, tokens: used.tokens };
  }
}

/** The live dependencies: the person's own usage rows today, and the metered structured call. */
export function liveWordingDeps(a: {
  admin: SupabaseClient; tenantId: string; userId: string; budget: number; since: string;
}): WordingDeps {
  return {
    usage: async () => {
      const { data, error } = await a.admin.from("ai_usage_log").select("input_tokens, output_tokens")
        .eq("tenant_id", a.tenantId).eq("user_id", a.userId).eq("surface", BRIEFING_SURFACE).gte("created_at", a.since);
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return { calls: 0, tokens: 0 };
        throw new Error(error.message);
      }
      const rows = (data ?? []) as { input_tokens: number | null; output_tokens: number | null }[];
      return { calls: rows.length, tokens: rows.reduce((t, r) => t + (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0), 0) };
    },
    phrase: (system, prompt) => askStructuredMetered({
      tenantId: a.tenantId, userId: a.userId, surface: BRIEFING_SURFACE, budget: a.budget, effort: "low", maxTokens: 400,
      system, prompt, schema: WORDING_SCHEMA as unknown as Record<string, unknown>,
    }),
  };
}

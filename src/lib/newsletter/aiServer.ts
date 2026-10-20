import "server-only";
import { askStructuredMetered, aiConfigured } from "@/lib/ai/structured";
import { resolveMonthlyBudget } from "@/lib/ai/usageCap";
import type { TenantConfig } from "@/lib/constants";
import {
  SYSTEM_PROMPT, buildDraftPrompt, buildGlossary, buildRewritePrompt, buildTranslatePrompt, draftSchema, normaliseDraft,
  normaliseRewrite, normaliseTranslation, rewriteSchema, translateSchema,
  type CatalogueItem, type DraftResult, type RewriteTone, type TranslateResult, type TranslateSource,
} from "./ai";

// The studio's three AI tasks (draft, rewrite, translate). EVERY call goes
// through askStructuredMetered(): the per-tenant monthly allowance is checked
// before the model is called and an ai_usage_log row is written after it. This
// file never imports the SDK, and a test keeps it that way.

export const AI_SURFACE = "newsletter_studio";

export { aiConfigured };

export type AiCtx = { tenantId: string; userId: string | null; config: Partial<TenantConfig> };

/** The workspace's monthly token allowance (shared meter, so it is counted across every AI surface). */
export const budgetFor = (config: Partial<TenantConfig>): number => resolveMonthlyBudget(config.newsletter_studio?.monthly_token_budget);

const call = (ctx: AiCtx, prompt: string, schema: Record<string, unknown>, maxTokens: number) =>
  askStructuredMetered({
    tenantId: ctx.tenantId, userId: ctx.userId, surface: AI_SURFACE, budget: budgetFor(ctx.config),
    system: SYSTEM_PROMPT, prompt, schema, effort: "medium", maxTokens,
  });

export async function aiDraft(ctx: AiCtx, input: {
  brief: string; companyName: string; industry?: string | null; tone: "formal" | "warm"; footerAddress?: string;
  catalogue: CatalogueItem[]; recentSubjects: string[]; topicLabel?: string | null;
}): Promise<DraftResult> {
  const raw = await call(ctx, buildDraftPrompt(input), draftSchema(), 5000);
  return normaliseDraft(raw, input.catalogue, ctx.tenantId, input.footerAddress ?? "");
}

export async function aiRewrite(ctx: AiCtx, input: { text: string; tone: RewriteTone; lang: string; companyName: string; maxLen: number }): Promise<{ text: string } | null> {
  const raw = await call(ctx, buildRewritePrompt({ text: input.text, tone: input.tone, lang: input.lang, glossary: [input.companyName] }), rewriteSchema(), 1500);
  return normaliseRewrite(raw, input.text, input.maxLen);
}

export async function aiTranslate(ctx: AiCtx, input: { source: TranslateSource; target: string; tone: "formal" | "warm"; companyName: string }): Promise<TranslateResult> {
  const glossary = buildGlossary(input.companyName, input.source);
  const raw = await call(ctx, buildTranslatePrompt({ source: input.source, target: input.target, tone: input.tone, glossary }), translateSchema(), 7000);
  return normaliseTranslation(raw, input.source, input.target);
}

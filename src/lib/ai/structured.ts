import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminSupabase } from "@/lib/supabase-server";
import { evaluateAllowance, monthStartIso, sumTokens, OVER_BUDGET_MESSAGE, type Allowance, type UsageRow } from "./usageCap";

// One place that calls the model with a JSON schema and meters it (docs/
// process-design-studio-architecture.md section 6.3). Same call shape as the RFQ
// reader and the estimator (claude-opus-5-5, structured output through
// output_config.format json_schema, no tools), plus what neither has: a
// per-tenant monthly allowance checked BEFORE the call and an ai_usage_log row
// written AFTER it. Those two surfaces can move onto it by passing a `surface`;
// this change deliberately leaves them as they are.
//
// There is NO tool the model can call here and nothing it emits is executed, so
// the worst a hostile document or message can do is a silly answer a person sees.
// The caller wraps every piece of untrusted text in data tags (see studio/prompts.ts).

export const AI_MODEL = "claude-opus-5-5";

export class AiError extends Error {
  constructor(message: string, public status = 422, public code: "not_configured" | "over_budget" | "failed" = "failed") {
    super(message);
  }
}

export const aiConfigured = (): boolean => !!process.env.ANTHROPIC_API_KEY;

/** A table or column the database does not have yet (migration pending). */
function isMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "42703" || err.code === "PGRST205" || err.code === "PGRST204"
    || /does not exist|Could not find the table|schema cache/i.test(err.message ?? "");
}

const PAGE = 1000;

/** Tokens this tenant has used since the start of the month. A missing table reads as zero (the cap is simply not enforced yet). */
export async function monthlyTokensUsed(tenantId: string, now: Date = new Date()): Promise<number> {
  const admin = createAdminSupabase();
  const since = monthStartIso(now);
  let total = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("ai_usage_log").select("input_tokens, output_tokens")
      .eq("tenant_id", tenantId).gte("created_at", since)
      .range(from, from + PAGE - 1);
    if (error) {
      if (isMissing(error)) return 0;
      throw new AiError("Could not check the AI allowance.", 500);
    }
    const rows = (data ?? []) as UsageRow[];
    total += sumTokens(rows);
    if (rows.length < PAGE) break;
  }
  return total;
}

export async function allowanceFor(tenantId: string, budget: number): Promise<Allowance> {
  return evaluateAllowance(await monthlyTokensUsed(tenantId), budget);
}

export async function logUsage(row: {
  tenantId: string; userId: string | null; surface: string; studyId: string | null; inputTokens: number; outputTokens: number; /** The model that ran; defaults to AI_MODEL for the callers that never named one. */ model?: string;
}): Promise<void> {
  try {
    const { error } = await createAdminSupabase().from("ai_usage_log").insert({
      tenant_id: row.tenantId, user_id: row.userId, surface: row.surface, study_id: row.studyId,
      model: row.model ?? AI_MODEL, input_tokens: row.inputTokens, output_tokens: row.outputTokens,
    });
    if (error && !isMissing(error)) console.error("ai_usage_log insert failed:", error.message);
  } catch (e) {
    console.error("ai_usage_log insert failed:", e);
  }
}

export type StructuredCall = {
  tenantId: string;
  userId: string | null;
  surface: string;
  studyId?: string | null;
  /** The tenant's monthly token budget (resolveMonthlyBudget of its config). */
  budget: number;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  effort?: "low" | "medium";
  maxTokens?: number;
};

export async function askStructuredMetered(call: StructuredCall): Promise<unknown> {
  if (!aiConfigured()) throw new AiError("AI is not set up for this workspace.", 503, "not_configured");
  const allowance = await allowanceFor(call.tenantId, call.budget);
  if (!allowance.allowed) throw new AiError(OVER_BUDGET_MESSAGE, 429, "over_budget");

  const client = new Anthropic();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: call.maxTokens ?? 6000,
      system: call.system,
      output_config: { effort: call.effort ?? "medium", format: { type: "json_schema", schema: call.schema } },
      messages: [{ role: "user", content: call.prompt }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("The AI service rejected the API key.", 502);
    if (e instanceof Anthropic.RateLimitError) throw new AiError("The AI service is busy. Try again in a moment.", 429);
    if (e instanceof Anthropic.BadRequestError) throw new AiError("The AI service could not read this request.", 422);
    if (e instanceof Anthropic.APIConnectionError) throw new AiError("Could not reach the AI service. Try again.", 502);
    if (e instanceof Anthropic.APIError) throw new AiError(`AI service error (${e.status}).`, 502);
    throw new AiError("The AI request failed.", 502);
  }

  await logUsage({
    tenantId: call.tenantId, userId: call.userId, surface: call.surface, studyId: call.studyId ?? null,
    inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0,
  });

  if (response.stop_reason === "refusal") throw new AiError("The AI declined this request.");
  if (response.stop_reason === "max_tokens") throw new AiError("The answer was too long to read in one go.");
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("The AI's answer could not be read.");
  }
}

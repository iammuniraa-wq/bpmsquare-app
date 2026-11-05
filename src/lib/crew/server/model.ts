// Deliberately NOT "server-only": the evaluation script (scripts/crew-eval.ts, run with jiti) builds the same real model, and nothing client-side imports this file.
import Anthropic from "@anthropic-ai/sdk";
import { modelFor } from "@/lib/assistant/models";
import type { ContentBlock, CrewModel, ModelReply, ModelRequest } from "../core/loop";
import type { ModelTier } from "../types";

// The real model behind the run loop. Same client and the same two tiers the dock assistant uses (ANTHROPIC_API_KEY, no new secret).
// The loop never retries a call that failed for a content reason; this adapter retries only 429 / 5xx / connection errors, twice, with backoff
// (design section 3.11). Messages are passed through as they are: the loop already speaks Anthropic's content-block shapes.

export const aiConfigured = (): boolean => !!process.env.ANTHROPIC_API_KEY;
export const crewDisabled = (): boolean => process.env.CREW_DISABLED === "1" || process.env.CREW_DISABLED === "true";

export class CrewModelError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function anthropicModel(tier: ModelTier, client: Anthropic = new Anthropic()): CrewModel {
  const model = modelFor(tier);
  return {
    async create(req: ModelRequest): Promise<ModelReply> {
      if (!aiConfigured()) throw new CrewModelError("AI is not set up for this workspace.");
      let lastError = "The AI service failed.";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = await client.messages.create({
            model,
            max_tokens: req.maxTokens,
            system: req.system,
            tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema })),
            messages: req.messages as Anthropic.MessageParam[],
            ...(tier === "small" ? { output_config: { effort: "low" as const } } : {}),
          });
          return {
            content: response.content as unknown as ContentBlock[],
            stopReason: response.stop_reason ?? "end_turn",
            usage: response.usage,
            model: response.model ?? model,
          };
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError) throw new CrewModelError("The AI service rejected the API key.");
          if (e instanceof Anthropic.BadRequestError) throw new CrewModelError("The AI service could not read this request.");
          const retryable = e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIConnectionError || (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500);
          lastError = e instanceof Anthropic.RateLimitError ? "The AI service is busy." : e instanceof Anthropic.APIConnectionError ? "Could not reach the AI service." : `AI service error (${(e as { status?: number }).status ?? "unknown"}).`;
          if (!retryable) throw new CrewModelError(lastError);
          await sleep(1500 * (attempt + 1));
        }
      }
      throw new CrewModelError(lastError);
    },
  };
}

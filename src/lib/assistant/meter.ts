import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { allowanceFor, logUsage } from "@/lib/ai/structured";
import type { Allowance } from "@/lib/ai/usageCap";
import { billedTokens, usagePercent, type ApiUsage } from "./models";

// The assistant's use of the AI meter (docs/nova-assistant-architecture.md section 6): the allowance is read
// before the first model call of an ask, every call is logged to ai_usage_log (surface "assistant") right after it
// returns, and the running total inside one ask stops the loop the moment the allowance is spent. The pooled
// allowance is the same one every other AI surface draws on.

export const ASSISTANT_SURFACE = "assistant";

export type MeterDeps = {
  allowanceFor: (tenantId: string, budget: number) => Promise<Allowance>;
  logUsage: typeof logUsage;
};

export class AssistantMeter {
  private used = 0;
  private opened = false;
  private readonly deps: MeterDeps;

  constructor(
    private readonly o: { tenantId: string; userId: string | null; budget: number },
    deps?: Partial<MeterDeps>,
  ) {
    this.deps = { allowanceFor, logUsage, ...deps };
  }

  /** Reads this month's use. Call once, before any model call. */
  async open(): Promise<Allowance> {
    const a = await this.deps.allowanceFor(this.o.tenantId, this.o.budget);
    this.used = a.used;
    this.opened = true;
    return a;
  }

  get budget(): number { return this.o.budget; }
  get usedTokens(): number { return this.used; }
  /** Whole percent of the allowance used, or null before open() has read it (an ask answered without a model never reads it). */
  get percent(): number | null { return this.opened ? usagePercent(this.used, this.o.budget) : null; }

  /** May another model call go ahead? False until open() has been called: no check, no call. */
  get allowed(): boolean { return this.opened && this.used < this.o.budget; }

  /** Logs one finished call and adds it to the running total. */
  async record(usage: ApiUsage | undefined | null, model: string): Promise<void> {
    const t = billedTokens(usage ?? {});
    this.used += t.input + t.output;
    await this.deps.logUsage({
      tenantId: this.o.tenantId, userId: this.o.userId, surface: ASSISTANT_SURFACE, studyId: null,
      inputTokens: t.input, outputTokens: t.output, model,
    });
  }

  /**
   * A client for code that makes its own model calls inside an ask (the chart tool's compile step). Every
   * messages.create through it is checked against the allowance first and logged after, so nothing the assistant
   * causes can run unmetered.
   */
  wrap(real: Anthropic): Anthropic {
    const meter = this;
    const messages = {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming, options?: Anthropic.RequestOptions) => {
        if (!meter.allowed) throw new Error("allowance spent");
        const res = await real.messages.create(params, options);
        await meter.record(res.usage, res.model ?? params.model);
        return res;
      },
    };
    return { messages } as unknown as Anthropic;
  }
}

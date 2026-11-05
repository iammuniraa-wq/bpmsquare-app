import { billedTokens, type ApiUsage } from "@/lib/assistant/models";
import type { ModelUsage } from "../core/loop";

// Tokens "as billed" (cache writes 1.25x, cache reads 0.1x), the unit the AI meter counts. One place so the runner and the eval agree.
export const billedTokensOf = (u: ModelUsage): { input: number; output: number } => billedTokens(u as ApiUsage);

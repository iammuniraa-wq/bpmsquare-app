import type { ProcessStudioConfig } from "@/lib/constants";
import { resolveMonthlyBudget } from "@/lib/ai/usageCap";

// The studio's own caps (docs/process-design-studio-architecture.md section 6.3).
// The monthly token allowance is the shared meter (ai/usageCap.ts); the message
// cap is the studio's: it stops a chat from running forever inside one study.

export const DEFAULT_MAX_MESSAGES_PER_STUDY = 40;
/** A single message is clipped, whatever the box allowed; a pasted document is not a message. */
export const MAX_MESSAGE_CHARS = 4000;

export function resolveMaxMessages(cfg: ProcessStudioConfig | undefined): number {
  const n = cfg?.max_messages_per_study;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 && n <= 500 ? Math.floor(n) : DEFAULT_MAX_MESSAGES_PER_STUDY;
}

export const resolveBudget = (cfg: ProcessStudioConfig | undefined): number => resolveMonthlyBudget(cfg?.monthly_token_budget);

/** May the client send another message? `sent` counts only the client's own. */
export function messageAllowed(sent: number, cap: number): boolean {
  return sent < cap;
}

export const MESSAGE_CAP_TEXT = "This study has reached its message limit. Press Build my process map to continue with what you have told us, or ask the BPMSquare team to raise the limit.";

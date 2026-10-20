// The pure half of the AI meter (docs/process-design-studio-architecture.md
// section 6.3): what the monthly allowance is, whether a call may go ahead, and
// when "this month" starts. No I/O, so the cap rules are unit-tested; the
// metered call itself is ai/structured.ts. Written for the Process Design
// Studio and shaped so any later AI surface can use it by passing a `surface`.

/** Tokens (input + output) a workspace may use per calendar month when a platform admin has not set one. */
export const DEFAULT_MONTHLY_TOKEN_BUDGET = 1_500_000;

/** A configured budget is honoured only when it is a sensible whole number; anything else falls back to the default. */
export function resolveMonthlyBudget(configured: unknown): number {
  const n = typeof configured === "number" ? configured : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000_000 ? Math.floor(n) : DEFAULT_MONTHLY_TOKEN_BUDGET;
}

/** First instant of the current calendar month, UTC, as an ISO string. */
export function monthStartIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export type Allowance = { allowed: boolean; used: number; budget: number; remaining: number };

/** May another call go ahead? A budget of 0 is "no AI for this workspace". Used tokens at or over the budget stop it. */
export function evaluateAllowance(usedTokens: number, budget: number): Allowance {
  const used = Math.max(0, Math.floor(usedTokens));
  const remaining = Math.max(0, budget - used);
  return { allowed: used < budget, used, budget, remaining };
}

export const OVER_BUDGET_MESSAGE =
  "You've used this month's AI allowance. The BPMSquare team can raise it. Your saved study stays readable.";

export type UsageRow = { input_tokens: number | null; output_tokens: number | null };

export const sumTokens = (rows: readonly UsageRow[]): number =>
  rows.reduce((a, r) => a + (Number(r.input_tokens) || 0) + (Number(r.output_tokens) || 0), 0);

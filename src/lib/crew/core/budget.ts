// Budget arithmetic (docs/design/nova-crew-agents.md section 3.8). Three ceilings, all checked BEFORE every model call, and the
// tightest wins: (1) the run's own maxTokensPerRun, (2) the agent's monthly cap, (3) the workspace's pooled allowance.
// Out of budget is a state, not an error. Pure.

export type BudgetInput = {
  runUsed: number;
  runCap: number;
  agentUsed: number;
  agentCap: number;
  pooledUsed: number;
  pooledBudget: number;
};

export type BudgetVerdict = {
  allowed: boolean;
  /** Tokens left under the tightest ceiling. */
  remaining: number;
  limitedBy: "run" | "agent" | "workspace" | null;
};

export function checkBudget(b: BudgetInput): BudgetVerdict {
  const left = {
    run: Math.max(0, b.runCap - b.runUsed),
    agent: Math.max(0, b.agentCap - b.agentUsed),
    workspace: Math.max(0, b.pooledBudget - b.pooledUsed),
  };
  const order: ("run" | "agent" | "workspace")[] = ["run", "agent", "workspace"];
  const tightest = order.reduce((a, k) => (left[k] < left[a] ? k : a), "run" as "run" | "agent" | "workspace");
  const remaining = left[tightest];
  return { allowed: remaining > 0, remaining, limitedBy: remaining > 0 ? null : tightest };
}

/** The cap an agent runs under: a workspace override set by a platform admin, else the agent definition's default. */
export function effectiveAgentCap(override: number | null | undefined, fallback: number): number {
  return typeof override === "number" && Number.isFinite(override) && override >= 0 ? Math.floor(override) : fallback;
}

/** Whole percent used of a cap, 0-100; a cap of 0 reads as 100 (the agent is switched off by its allowance). */
export function percentUsed(used: number, cap: number): number {
  if (cap <= 0) return 100;
  return Math.min(100, Math.max(0, Math.floor((used / cap) * 100)));
}

/** The card text for a spent allowance, by which ceiling stopped it. */
export function pausedReason(by: BudgetVerdict["limitedBy"]): string {
  if (by === "workspace") return "Paused: the workspace's monthly AI allowance is used up";
  if (by === "agent") return "Paused: monthly allowance reached";
  return "Stopped: this run reached its own limit";
}

// LOCAL CONTRACT. The shared crew contract (src/lib/crew/types.ts, "crew: agent contract") is built in another branch.
// This file re-declares the minimal shapes the Attendance Anomalies engine needs, following docs/design/nova-crew-agents.md
// sections 2 and 3 (agent model, tool adapters, approval gate). When the lead's contract lands, replace the bodies below
// with `export type { ... } from "../types"`; every other file in this folder imports only from here.

export type Severity = "info" | "review" | "urgent";

export type ToolResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export type ScheduleDef = {
  /** Workspace-local, "HH:MM". */
  at: string;
  /** 0 = Sunday ... 6 = Saturday; absent = every day. */
  weekdays?: number[];
  /** What span the run covers. */
  covers: "previous_shift_day" | "previous_seven_shift_days";
};

export type RunRequest = {
  agent_key: string;
  trigger: "schedule" | "event" | "manual";
  trigger_ref: string;
  /** Unique per (tenant, dedupe_key) in crew_runs. */
  dedupe_key: string;
  scope: { site_id: string; from: string; to: string };
  /** How many plain-code candidates cleared the threshold (0 never produces a request). */
  candidate_count: number;
};

export type ToolSpec = {
  key: string;
  description: string;
  /** JSON Schema of the arguments. The tenant is never an argument (design 3.4 rule 1). */
  args: Record<string, unknown>;
};

export type AgentLimits = { maxTurns: number; maxToolCalls: number; maxTokensPerRun: number; deadlineMs: number };

export type AgentDefinition<PlanCtx = unknown> = {
  key: string;
  title: string;
  goal: string;
  prompt_version: string;
  requires: { features: string[] };
  triggers: { schedule: ScheduleDef[] };
  plan: (ctx: PlanCtx) => Promise<RunRequest[]>;
  tools: ToolSpec[];
  /** What a proposal may ask a person to do (design 3.5). */
  actions: string[];
  outputSchema: Record<string, unknown>;
  limits: AgentLimits;
  tier: "small" | "mid";
  defaults: { sensitivity: "quiet" | "balanced" | "thorough"; families: Record<string, boolean> };
  autonomy: "propose";
  evalSet: string;
};

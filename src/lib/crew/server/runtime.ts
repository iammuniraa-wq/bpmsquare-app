import "server-only";
import type { StepOutputs, ValidatedFinding } from "../core/grounding";
import type { DraftFinding, JSONSchema, Ref, RunContext, ToolAdapter } from "../types";
import type { RunRow } from "./store";

// What an agent plugs into the runner (docs/design/nova-crew-agents.md section 2). The AgentDefinition (types.ts) says WHAT the agent is;
// the AgentRuntime says how to prepare one run of it: the prefetch, the first message, who may be addressed, how a finding is fingerprinted.
// Adding an agent = a definition + a runtime + one line in src/lib/crew/definitions.ts + one entry in registry.ts. The runner is never edited.

export type Prepared = {
  /** The first user message of the run (includes the prefetch, wrapped as data). */
  user: string;
  /** Becomes step s1: the batched read of the candidate facts, cited by the model as s1. */
  prefetch: { name: string; output: unknown; refs: Ref[] };
  /** Members a note about this finding may be addressed to; null = no note allowed. Computed in code, never by the model. */
  permittedRecipients: (draft: DraftFinding) => ReadonlySet<string> | null;
  /** The key fact of a finding, bucketed (goes into the fingerprint). */
  bucketOf: (kind: string, subjectId: string) => string;
  /** Who sees a finding and may approve a note about it. */
  seenBy: (subjectId: string) => string[];
  /** Bid end date or similar, to cap how long a proposal stays open. */
  closesAt: (subjectId: string) => string | null;
  labelOf: (subjectId: string) => string;
  hrefFor: (ref: Ref) => string | null;
  /** Reduce note recipients to current workspace members. */
  members: (ids: string[]) => Promise<string[]>;
  /** Saved on the run so the next one can say what changed. */
  snapshot: Record<string, unknown> | null;
  /** Facts that could not be read (a table pending a migration): shown in the trace and given to the model as gaps. */
  unavailable: string[];
  /** Attendance: alias -> real id, per run. Saved on the run (crew_runs.alias_map, service role only), handed to the tools, never shown to the model. */
  aliasMap?: { persons: Record<string, string>; sites: Record<string, string> } | null;
  /** Ids a tool call may name besides the run's candidates (attendance: the aliases of the people in the candidates). */
  toolIds?: string[];
  /** Whatever the agent's own submission handler needs again after the model answers (attendance: the digest and who is addressed). Opaque to the runner. */
  state?: unknown;
};

/** For an agent whose submission is richer than DraftFinding (attendance): it parses, validates and maps the model's raw submission itself. */
export type SubmissionHandler = {
  validate: (raw: unknown, steps: StepOutputs, prepared: Prepared) => { accepted: ValidatedFinding[]; rejected: { index: number; reason: string }[] };
};

export type AgentRuntime = {
  adapters: ToolAdapter[];
  banned: readonly string[];
  kinds: readonly string[];
  findingsSchema: JSONSchema;
  system: () => string;
  prepare: (ctx: RunContext, run: RunRow) => Promise<Prepared>;
  /** Absent = the generic DraftFinding validation (Tender Watch). */
  submission?: SubmissionHandler;
};

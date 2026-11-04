import "server-only";
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
};

export type AgentRuntime = {
  adapters: ToolAdapter[];
  banned: readonly string[];
  kinds: readonly string[];
  findingsSchema: JSONSchema;
  system: () => string;
  prepare: (ctx: RunContext, run: RunRow) => Promise<Prepared>;
};

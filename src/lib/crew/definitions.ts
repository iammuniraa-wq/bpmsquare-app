import "server-only";
import type { AgentRuntime } from "./server/runtime";
import { tenderWatch } from "./tender/definition";
import { tenderRuntime } from "./tender/runtime";
import type { AgentDefinition, AgentKey } from "./types";

// The server-side loader map: agent key -> its definition and runtime. One line per agent. The Attendance engine (src/lib/crew/attendance/**)
// is registered here by the lead when it lands, together with flipping `engine` to "ready" in registry.ts; until then the planner enqueues
// nothing for it and its tile says "Needs setup".

export type AgentModule = { def: AgentDefinition; runtime: AgentRuntime };

const MODULES: Partial<Record<AgentKey, AgentModule>> = {
  tender_watch: { def: tenderWatch, runtime: tenderRuntime },
};

export function agentModule(key: AgentKey): AgentModule | null {
  return MODULES[key] ?? null;
}

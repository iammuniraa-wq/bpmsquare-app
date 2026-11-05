import "server-only";
import type { AgentRuntime } from "./server/runtime";
import { attendanceDefinition, attendanceRuntime } from "./server/attendance";
import { tenderWatch } from "./tender/definition";
import { tenderRuntime } from "./tender/runtime";
import type { AgentDefinition, AgentKey } from "./types";

// The server-side loader map: agent key -> its definition and runtime. One line per agent; the agent is also "ready" in registry.ts.

export type AgentModule = { def: AgentDefinition; runtime: AgentRuntime };

const MODULES: Partial<Record<AgentKey, AgentModule>> = {
  tender_watch: { def: tenderWatch, runtime: tenderRuntime },
  attendance: { def: attendanceDefinition, runtime: attendanceRuntime },
};

export function agentModule(key: AgentKey): AgentModule | null {
  return MODULES[key] ?? null;
}

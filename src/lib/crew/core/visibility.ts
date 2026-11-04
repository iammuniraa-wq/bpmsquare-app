// Who may see what (docs/design/nova-crew-agents.md sections 3.6, 5.5 and 7). Pure: the routes and pages build a `Viewer` from the session and
// ask here, and the tests ask the same function. These tables carry no member policy, so this is the filter that decides.

import type { AgentKey } from "../types";

export type Viewer = { role: "admin" | "member"; userId: string; /** The viewer may open the Pipeline workcenter. */ pipeline: boolean };
export type Visibility = "admins" | "deal_teams" | undefined;

/**
 * May this viewer read this finding? A workspace admin always. Tender: someone the finding was addressed to (deal owner and team) once a platform
 * admin has widened the agent from the admin-only shadow to "deal_teams", and only with the Pipeline workcenter. Attendance is ADMIN-ONLY until
 * the supervisor slice defines site scope (design section 7, S3 shadow); a supervisor never sees a finding about themselves.
 */
export function canSeeFinding(v: Viewer, f: { agent_key: AgentKey; recipient_ids: readonly string[] }, visibility: Visibility): boolean {
  if (v.role === "admin") return true;
  if (f.agent_key === "attendance") return false;
  if (visibility !== "deal_teams" || !v.pipeline) return false;
  return f.recipient_ids.includes(v.userId);
}

/** Runs and traces: workspace admins always; others only where a platform admin has widened the agent from the admin-only shadow. */
export function canSeeRuns(v: Pick<Viewer, "role">, visibility: Visibility): boolean {
  return v.role === "admin" || visibility === "deal_teams";
}

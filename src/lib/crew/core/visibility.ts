// Who may see what (docs/design/nova-crew-agents.md sections 3.6, 5.5 and 7). Pure: the routes and pages build a `Viewer` from the session and
// ask here, and the tests ask the same function. These tables carry no member policy, so this is the filter that decides.

import { canViewFinding } from "../attendance/scope";
import type { ViewerScope } from "../attendance/facts";
import type { AgentKey } from "../types";

export type Viewer = {
  role: "admin" | "member";
  userId: string;
  /** The viewer may open the Pipeline workcenter. */
  pipeline: boolean;
  /**
   * Attendance: the viewer's WFM scope (resolveWfmScope) when they are a supervisor, else null/absent. A supervisor sees a finding only when its site is a
   * site they supervise or its person is in their subtree; the scope never contains the viewer, so a supervisor never sees a finding about themselves.
   */
  attendance?: ViewerScope | null;
};
export type Visibility = "admins" | "deal_teams" | undefined;

export type FindingLike = {
  agent_key: AgentKey;
  recipient_ids: readonly string[];
  site_id?: string | null;
  subject_type?: string;
  subject_id?: string;
};

/**
 * May this viewer read this finding? A workspace admin always. Tender: someone the finding was addressed to (deal owner and team) once a platform
 * admin has widened the agent from the admin-only shadow to "deal_teams", and only with the Pipeline workcenter. Attendance: the same shadow rule,
 * and then only by site scope (design section 5.5), never by who was merely listed.
 */
export function canSeeFinding(v: Viewer, f: FindingLike, visibility: Visibility): boolean {
  if (v.role === "admin") return true;
  if (visibility !== "deal_teams") return false;
  if (f.agent_key === "attendance") {
    if (!v.attendance) return false;
    return canViewFinding({ site_id: f.site_id ?? null, employee_id: f.subject_type === "employee" ? f.subject_id ?? null : null }, v.attendance);
  }
  if (!v.pipeline) return false;
  return f.recipient_ids.includes(v.userId);
}

/** Runs and traces: workspace admins always; others only where a platform admin has widened the agent from the admin-only shadow. */
export function canSeeRuns(v: Pick<Viewer, "role">, visibility: Visibility): boolean {
  return v.role === "admin" || visibility === "deal_teams";
}

/**
 * One run's trace. Attendance runs are about one site: a supervisor opens only the runs of sites they supervise. A pass that looked at no site
 * (a quiet day, "4 sites checked") names no person and is shown to admins only.
 */
export function canSeeRun(v: Viewer, r: { agent_key: AgentKey; scope?: { site_id?: string } | null }, visibility: Visibility): boolean {
  if (v.role === "admin") return true;
  if (!canSeeRuns(v, visibility)) return false;
  if (r.agent_key !== "attendance") return true;
  const site = r.scope?.site_id;
  return !!v.attendance && !!site && (v.attendance.unrestricted || v.attendance.siteIds.includes(site));
}

import type { FinanceVisibility } from "./types";

// Who sees cost and margin (design section 8). PURE: the caller resolves the facts (the role, the Business Role grants, whether the person
// manages the project) and this decides, so the loaders, the routes, the pages and the tests share one rule. Enforced where the data is
// made: a loader that fails this returns nothing and no figure travels in page props.

export type FinanceCaller = {
  /** The workspace owns the module (features.project_dashboards, needing contract_projects). */
  moduleOn: boolean;
  visibility: FinanceVisibility;
  role: "admin" | "member";
  /** The caller may open Contract projects at all. */
  canOpenProjects: boolean;
  /** `unrestricted` = an admin or a member with no Business Role: they have no explicit grants, which is why "granted" mode refuses them. */
  unrestricted: boolean;
  /** The caller's Business Roles carry the project_finance workcenter with view. */
  hasGrant: boolean;
};

/** The workspace-wide answer: the portfolio, the dashboard tiles and the Reports metrics. */
export function canSeeFinance(c: FinanceCaller): boolean {
  if (!c.moduleOn || !c.canOpenProjects) return false;
  if (c.visibility === "everyone") return true;
  return c.role === "admin" || (!c.unrestricted && c.hasGrant);
}

/** One project: the same, plus the project manager for the projects they manage (in "granted" mode only; "everyone" already passes). */
export function canSeeProjectFinance(c: FinanceCaller, project: { manager_id: string | null }, userId: string): boolean {
  if (!c.moduleOn || !c.canOpenProjects) return false;
  if (canSeeFinance(c)) return true;
  return c.visibility === "granted" && !!project.manager_id && project.manager_id === userId;
}

/** Of a list of projects, the ones this caller may see finance for. */
export function financeVisibleProjects<P extends { manager_id: string | null }>(c: FinanceCaller, projects: readonly P[], userId: string): P[] {
  return projects.filter((p) => canSeeProjectFinance(c, p, userId));
}

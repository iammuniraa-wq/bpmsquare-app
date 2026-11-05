// Who may see what (design 5.5). The engine never queries; it filters with the result of resolveWfmScope(), which the
// runner / the findings route passes in. Because the scope never contains the viewer, a supervisor never sees findings
// about themselves (their manager and admins do).

import type { ViewerScope } from "./facts";

/** Keep only the employee ids the viewer may see. Unrestricted viewers keep all of them. */
export function scopeEmployeeIds(ids: string[], scope: ViewerScope | null): string[] {
  if (!scope || scope.unrestricted) return ids;
  const allowed = new Set(scope.employeeIds ?? []);
  return ids.filter((id) => allowed.has(id));
}

export function canViewSite(siteId: string, scope: ViewerScope | null): boolean {
  if (!scope || scope.unrestricted) return true;
  return scope.siteIds.includes(siteId);
}

/** A stored finding, as the visibility filter sees it (real ids; the runner resolved the aliases when it persisted). */
export type ScopableFinding = { site_id: string | null; employee_id: string | null };

/**
 * A finding is visible when its site is in the viewer's site scope, or its employee is in the viewer's employee scope.
 * A person-level finding with an employee the viewer cannot see is hidden even when the site is theirs: a supervisor is
 * not in their own scope, so findings about the supervisor never reach them.
 */
export function canViewFinding(f: ScopableFinding, scope: ViewerScope): boolean {
  if (scope.unrestricted) return true;
  if (f.employee_id) return (scope.employeeIds ?? []).includes(f.employee_id);
  return f.site_id !== null && scope.siteIds.includes(f.site_id);
}

export function filterFindings<T extends ScopableFinding>(findings: T[], scope: ViewerScope): T[] {
  return findings.filter((f) => canViewFinding(f, scope));
}

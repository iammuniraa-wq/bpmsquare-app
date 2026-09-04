import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";
import { resolveProject, type SiteProjectLink } from "./projectAttribution";

type Admin = ReturnType<typeof createAdminSupabase>;

/**
 * Resolve the project a punch should be stamped with (WFM_PROJECT_COSTING.md
 * §4). Precedence lives in the pure resolver; this only fetches its inputs.
 *
 * Never throws and never blocks a punch: attendance is the contract-facing
 * record and must not fail because a costing lookup did. Every error path
 * returns null, which is a legitimate "unassigned" the supervisor can fix
 * later -- a refused punch is not recoverable at all.
 *
 * The 42P01 tolerance is deliberate per §3b: 0104 is applied by hand, so the
 * code has to degrade cleanly while the migration is still pending.
 */
export async function resolveProjectForPunch(
  admin: Admin,
  tenantId: string,
  employeeId: string,
  dayKey: string,
  siteId: string | null
): Promise<string | null> {
  try {
    const { data: roster } = await admin
      .from("wfm_roster_assignments")
      .select("project_id")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employeeId)
      .eq("date", dayKey)
      .maybeSingle();

    const rosterProjectId = (roster?.project_id as string | null) ?? null;
    if (rosterProjectId) return rosterProjectId;
    if (!siteId) return null;

    // Only this site's links are fetched, and the date filter is applied in
    // the pure resolver rather than here -- keeping the precedence rules in
    // one testable place is worth returning a handful of extra rows.
    const { data: links } = await admin
      .from("wfm_project_sites")
      .select("project_id, site_id, from_date, to_date, wfm_projects(status)")
      .eq("tenant_id", tenantId)
      .eq("site_id", siteId);

    const shaped: SiteProjectLink[] = (links ?? []).map((l) => {
      const project = l.wfm_projects as { status?: string } | { status?: string }[] | null;
      const status = Array.isArray(project) ? project[0]?.status : project?.status;
      return {
        project_id: l.project_id as string,
        site_id: l.site_id as string,
        from_date: l.from_date as string,
        to_date: (l.to_date as string | null) ?? null,
        project_status: status ?? "",
      };
    });

    return resolveProject(null, shaped, siteId, dayKey);
  } catch {
    return null;
  }
}

import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";
import { resolveAttribution, type Attribution, type ProjectLink } from "./projectAttribution";

type Admin = ReturnType<typeof createAdminSupabase>;

const EMPTY: Attribution = { project_id: null, source: "none", ambiguous: false };

/**
 * Fetch the project links that could possibly claim this punch, joined to
 * their project's status and date window.
 *
 * Only links naming THIS employee, THIS shift or THIS site are fetched --
 * nothing else can match, and a tenant with hundreds of projects shouldn't
 * pay for all of them on every punch. The eligibility rules (status, dates,
 * ambiguity) stay in the pure resolver so they remain testable.
 */
async function fetchLinks(
  admin: Admin,
  tenantId: string,
  employeeId: string,
  shiftId: string | null,
  siteId: string | null
): Promise<ProjectLink[]> {
  const clauses = [`employee_id.eq.${employeeId}`];
  if (shiftId) clauses.push(`shift_id.eq.${shiftId}`);
  if (siteId) clauses.push(`site_id.eq.${siteId}`);

  const { data } = await admin
    .from("wfm_project_links")
    .select("project_id, site_id, employee_id, shift_id, wfm_projects(status, start_date, end_date)")
    .eq("tenant_id", tenantId)
    .or(clauses.join(","));

  return (data ?? []).map((l) => {
    const proj = l.wfm_projects as
      | { status?: string; start_date?: string | null; end_date?: string | null }
      | { status?: string; start_date?: string | null; end_date?: string | null }[]
      | null;
    const p = Array.isArray(proj) ? proj[0] : proj;
    return {
      project_id: l.project_id as string,
      project_status: p?.status ?? "",
      project_start: p?.start_date ?? null,
      project_end: p?.end_date ?? null,
      site_id: (l.site_id as string | null) ?? null,
      employee_id: (l.employee_id as string | null) ?? null,
      shift_id: (l.shift_id as string | null) ?? null,
    };
  });
}

/**
 * Resolve the project a punch should be stamped with (WFM_PROJECT_COSTING.md
 * §4). Precedence lives in the pure resolver; this only gathers its inputs.
 *
 * Never throws and never blocks a punch: attendance is the contract-facing
 * record and must not fail because a costing lookup did. Every error path
 * returns unassigned, which a supervisor can see and fix later -- a refused
 * punch cannot be recovered at all.
 *
 * The 42P01 tolerance is deliberate per §3b: 0104/0105 are applied by hand,
 * so this has to degrade cleanly while a migration is still pending.
 */
export async function resolveProjectForPunch(
  admin: Admin,
  tenantId: string,
  employeeId: string,
  dayKey: string,
  siteId: string | null,
  shiftId: string | null = null
): Promise<string | null> {
  return (await attributePunch(admin, tenantId, employeeId, dayKey, siteId, shiftId)).project_id;
}

/** Same resolution, but keeps WHICH rung decided — for screens that explain
 *  themselves rather than just stating an answer. */
export async function attributePunch(
  admin: Admin,
  tenantId: string,
  employeeId: string,
  dayKey: string,
  siteId: string | null,
  shiftId: string | null = null
): Promise<Attribution> {
  try {
    const { data: roster } = await admin
      .from("wfm_roster_assignments")
      .select("project_id")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employeeId)
      .eq("date", dayKey)
      .maybeSingle();

    const rosterProjectId = (roster?.project_id as string | null) ?? null;
    if (rosterProjectId) {
      return { project_id: rosterProjectId, source: "roster", ambiguous: false };
    }

    const links = await fetchLinks(admin, tenantId, employeeId, shiftId, siteId);
    return resolveAttribution(null, links, { employeeId, siteId, shiftId, date: dayKey });
  } catch {
    return EMPTY;
  }
}

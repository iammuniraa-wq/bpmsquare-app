import "server-only";

import type { createAdminSupabase } from "@/lib/supabase-server";
import { getWfmConfig, dateKeyInTz } from "@/lib/wfm/server";
import { workSessions } from "@/lib/wfm/hours";
import { rollUpProjectHours, projectHeadcount, UNASSIGNED, type SessionsForEmployee } from "@/lib/wfm/projectHours";
import { rollUp, depthOf, descendantsOf } from "@/lib/wfm/projectTree";

type Admin = ReturnType<typeof createAdminSupabase>;

export type ProjectHoursRow = {
  key: string;
  gross_minutes: number;
  break_minutes: number;
  net_minutes: number;
  sessions: number;
  employees: number;
  /** What landed directly on this row. */
  own_minutes: number;
  /** Own plus everything beneath it in the tree. */
  total_minutes: number;
  /** Distinct people across this row AND everything beneath it -- the
   *  headcount that goes with total_minutes. `employees` is own-only. */
  employees_total: number;
};

export type ProjectMeta = {
  name: string;
  ref: string | null;
  status: string;
  parent_id: string | null;
  account_id: string | null;
  /** Level 0 is a project; 1..3 are sub-projects. */
  depth: number;
};

export type ProjectHoursReport = {
  from: string;
  to: string;
  deduct_breaks: boolean;
  rows: ProjectHoursRow[];
  projects: Record<string, ProjectMeta>;
  pending_migration?: true;
};

/**
 * Every employee's work sessions for a date window, project-stamped. The
 * one loader behind the hours report AND billing, so an invoice is built
 * from exactly the sessions the screen counted.
 */
export async function loadProjectSessions(
  admin: Admin,
  tenantId: string,
  from: string,
  to: string,
  employeeIds: string[] | null
): Promise<{ sessions: SessionsForEmployee[] } | { pending_migration: true }> {
  const config = await getWfmConfig(admin, tenantId);

  let eventsQuery = admin
    .from("wfm_presence_events")
    .select("employee_id, kind, ts, project_id")
    .eq("tenant_id", tenantId)
    .is("superseded_by", null)
    // Padded a day either side so a night shift's punches around midnight
    // are all present for the session split. The padding is for the SPLIT
    // only: a session belongs to the period by the local day it started
    // (below), so the day after `to` is never counted in -- it was, until
    // 2026-09-06, which put 1 September's hours on an August invoice.
    .gte("ts", new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString())
    .lt("ts", new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString())
    .order("ts", { ascending: true });
  if (employeeIds) eventsQuery = eventsQuery.in("employee_id", employeeIds);

  const { data: events, error } = await eventsQuery;
  if (error) {
    if (error.code === "42P01" || error.code === "42703") return { pending_migration: true };
    throw new Error(error.message);
  }

  const byEmployee = new Map<string, { kind: string; ts: string; project_id: string | null }[]>();
  for (const e of events ?? []) {
    const id = e.employee_id as string;
    byEmployee.set(id, [...(byEmployee.get(id) ?? []), e as never]);
  }
  const endRef = new Date();
  const inPeriod = (s: { in: string }) => {
    const day = dateKeyInTz(new Date(s.in), config.timezone);
    return day >= from && day <= to;
  };
  return {
    sessions: [...byEmployee].map(([employee_id, evs]) => ({
      employee_id,
      sessions: workSessions(evs as never, endRef).filter(inPeriod),
    })),
  };
}

/** The local day a session belongs to -- the day it started, in the
 *  tenant's timezone. The same rule loadProjectSessions() applies, so a
 *  row's `date` and the period it was billed in can never disagree. */
export function sessionDay(sessionIn: string, timezone: string): string {
  return dateKeyInTz(new Date(sessionIn), timezone);
}

/**
 * Worked hours rolled up per project for a date window -- the one
 * implementation behind the Projects screens AND the v1 API, so an invoice
 * built from the API can never disagree with the number a supervisor sees.
 *
 * `employeeIds` narrows to a supervisor's own people (null = everyone, which
 * is what an API key gets: it is tenant-wide by definition). `projectId`
 * narrows the result to one project and everything beneath it, which is how
 * a period is billed for one job.
 *
 * Never throws for a pending migration: 42P01/42703 come back as an empty
 * report flagged pending_migration, per §3b.
 */
export async function projectHoursReport(
  admin: Admin,
  tenantId: string,
  from: string,
  to: string,
  opts: { employeeIds?: string[] | null; projectId?: string | null } = {}
): Promise<ProjectHoursReport> {
  const config = await getWfmConfig(admin, tenantId);
  const base: ProjectHoursReport = { from, to, deduct_breaks: config.deduct_breaks, rows: [], projects: {} };

  if (opts.employeeIds && opts.employeeIds.length === 0) return base;

  const loaded = await loadProjectSessions(admin, tenantId, from, to, opts.employeeIds ?? null);
  if ("pending_migration" in loaded) return { ...base, pending_migration: true };
  const input = loaded.sessions;

  const rows = rollUpProjectHours(input, config.deduct_breaks);
  const heads = projectHeadcount(input);

  // The WHOLE tree is fetched, not just the projects with hours: an hour
  // booked to a sub-project has to appear in its parent's total, and the
  // parent may have no punches of its own.
  const { data: allProjects } = await admin
    .from("wfm_projects")
    .select("id, name, ref, status, parent_id, account_id")
    .eq("tenant_id", tenantId);
  const tree = (allProjects ?? []).map((p) => ({ id: p.id as string, parent_id: (p.parent_id as string | null) ?? null }));
  const byId = new Map(tree.map((t) => [t.id, t]));

  const ownMinutes = new Map<string, number>();
  for (const r of rows) if (r.key !== UNASSIGNED) ownMinutes.set(r.key, r.net_minutes);
  const rolled = rollUp(tree, ownMinutes);

  const projects: Record<string, ProjectMeta> = {};
  for (const p of allProjects ?? []) {
    const id = p.id as string;
    projects[id] = {
      name: p.name as string,
      ref: (p.ref as string | null) ?? null,
      status: p.status as string,
      parent_id: (p.parent_id as string | null) ?? null,
      account_id: (p.account_id as string | null) ?? null,
      depth: depthOf(byId, id) ?? 0,
    };
  }

  // Headcount rolled up the same way as minutes: the set of people on a row
  // or anything beneath it. A count can't be summed up a tree (one person on
  // two sub-projects is still one person), so this carries the sets.
  const peopleOwn = new Map<string, Set<string>>();
  for (const emp of input) {
    for (const s of emp.sessions) {
      const key = s.project_id ?? UNASSIGNED;
      if (!peopleOwn.has(key)) peopleOwn.set(key, new Set());
      peopleOwn.get(key)!.add(emp.employee_id);
    }
  }
  const peopleTotal = new Map<string, Set<string>>();
  for (const [key, set] of peopleOwn) {
    let cur: string | null | undefined = key === UNASSIGNED ? null : key;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (!peopleTotal.has(cur)) peopleTotal.set(cur, new Set());
      for (const e of set) peopleTotal.get(cur)!.add(e);
      cur = byId.get(cur)?.parent_id ?? null;
    }
  }
  const headTotal = (key: string) =>
    key === UNASSIGNED ? (heads.get(key) ?? 0) : (peopleTotal.get(key)?.size ?? 0);

  const withRollup: ProjectHoursRow[] = rows.map((r) => ({
    ...r,
    employees: heads.get(r.key) ?? 0,
    employees_total: headTotal(r.key),
    own_minutes: r.net_minutes,
    total_minutes: r.key === UNASSIGNED ? r.net_minutes : (rolled.get(r.key)?.total ?? r.net_minutes),
  }));

  // A parent with no punches of its own still needs a row once its children
  // have hours -- otherwise a project whose work all sits on its sub-projects
  // would be missing from its own report.
  const present = new Set(withRollup.map((r) => r.key));
  for (const [id, v] of rolled) {
    if (present.has(id) || v.total === 0) continue;
    withRollup.push({
      key: id, gross_minutes: 0, break_minutes: 0, net_minutes: 0, sessions: 0,
      employees: 0, employees_total: headTotal(id), own_minutes: 0, total_minutes: v.total,
    });
  }
  withRollup.sort((a, b) => b.total_minutes - a.total_minutes);

  let out = withRollup;
  if (opts.projectId) {
    const keep = new Set([opts.projectId, ...descendantsOf(tree, opts.projectId)]);
    out = withRollup.filter((r) => keep.has(r.key));
  }

  return { ...base, rows: out, projects };
}

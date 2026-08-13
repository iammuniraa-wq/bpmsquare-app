import "server-only";

import { cache } from "react";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { WfmContext } from "./server";

type Admin = ReturnType<typeof createAdminSupabase>;

/**
 * WFM reporting-tree scoping.
 *
 * The client's org model (2026-08-12): a site has one supervisor, and an
 * employee's approver is whoever runs the site they are ASSIGNED TO -- which
 * changes week to week. Supervisors report upward through
 * employees.supervisor_id, and that chain can be any depth.
 *
 *   employee ──(site assigned on that date)──▶ wfm_sites.supervisor_id
 *   supervisor ──employees.supervisor_id──▶ manager ──▶ …
 *
 * "Manager" is therefore not a role: it is a supervisor with other
 * supervisors beneath them, and their reach is the union of their whole
 * subtree. A tenant admin sits above the tree entirely and is unrestricted.
 *
 * Two DIFFERENT questions, deliberately answered by two functions:
 *
 *  - VISIBILITY (`resolveWfmScope`)  — "whose rows may I see in this list?"
 *    Evaluated over a date RANGE and intentionally permissive at the edges:
 *    somebody who worked at my site at any point in the range is mine to see.
 *
 *  - AUTHORITY  (`canApproveFor`)    — "may I approve THIS request?"
 *    Evaluated against the assignment on the request's own target date, so
 *    authority sits with whoever actually supervised the work -- not with
 *    whoever happens to run that site today. (Client's explicit choice.)
 *
 * Resolution is done here in the API layer rather than in an RLS policy: a
 * recursive subtree lookup inside a policy runs per row, which is exactly
 * where that pattern falls over. RLS stays the coarse tenant backstop.
 */

/** How deep the supervisor chain is walked before we assume a cycle. */
const MAX_DEPTH = 12;

export type WfmScope = {
  /** Tenant admin (or an explicitly wfm-granted login with no employee
   * record): sees everything, no employee filter applied. */
  unrestricted: boolean;
  /** Employee ids this caller may see. Empty = nothing. Null when unrestricted. */
  employeeIds: string[] | null;
  /** Sites this caller supervises, directly or through their subtree. */
  siteIds: string[];
  /** The caller's own employee id, if they have one. Never inside
   * employeeIds -- you are not in your own subtree, which is what makes
   * self-approval impossible rather than merely discouraged. */
  selfEmployeeId: string | null;
};

/** Every supervisor at or below `rootEmployeeId`, excluding the root itself. */
async function descendantSupervisors(
  admin: Admin,
  tenantId: string,
  rootEmployeeId: string
): Promise<string[]> {
  const found = new Set<string>();
  let frontier = [rootEmployeeId];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const { data } = await admin
      .from("employees")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("supervisor_id", frontier);

    const next = (data ?? [])
      .map((r) => r.id as string)
      .filter((id) => id !== rootEmployeeId && !found.has(id));
    next.forEach((id) => found.add(id));
    frontier = next;
  }

  return [...found];
}

/**
 * Who this caller may see, over a date range (defaults to "today only" when
 * no range is given). Cached per request via React `cache()` -- several
 * routes and their page components ask the same question in one render.
 */
export const resolveWfmScope = cache(async function resolveWfmScope(
  ctx: Pick<WfmContext, "tenantId" | "role" | "employee" | "isSupervisor">,
  range?: { from: string; to: string }
): Promise<WfmScope> {
  const { tenantId, role, employee, isSupervisor } = ctx;
  const selfEmployeeId = employee?.id ?? null;

  // A tenant admin is above the org tree. So is a login that holds an
  // explicit wfm Business-Role grant but no employee record -- it has no
  // place in the tree to be scoped from, and an admin assigned it
  // deliberately, so narrowing it to "nobody" would silently break it.
  if (role === "admin" || (isSupervisor && !employee)) {
    return { unrestricted: true, employeeIds: null, siteIds: [], selfEmployeeId };
  }

  // A plain employee sees only themselves.
  if (!isSupervisor || !employee) {
    return {
      unrestricted: false,
      employeeIds: selfEmployeeId ? [selfEmployeeId] : [],
      siteIds: [],
      selfEmployeeId,
    };
  }

  const admin = createAdminSupabase();

  // Me + every supervisor beneath me; the sites any of us run.
  const subordinates = await descendantSupervisors(admin, tenantId, employee.id);
  const treeIds = [employee.id, ...subordinates];

  const { data: siteRows } = await admin
    .from("wfm_sites")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("supervisor_id", treeIds);
  const siteIds = (siteRows ?? []).map((s) => s.id as string);

  const visible = new Set<string>(subordinates);

  if (siteIds.length > 0) {
    // Both depend only on siteIds and are independent of each other, so they
    // run together rather than one Seoul hop after the other:
    //   - home-site assignment (employees.site_id) is the standing default;
    //   - an explicit roster row overrides it for those dates, so anyone
    //     rostered onto one of my sites within the range is mine to see too.
    let rosterQuery = admin
      .from("wfm_roster_assignments")
      .select("employee_id")
      .eq("tenant_id", tenantId)
      .in("site_id", siteIds);
    if (range) rosterQuery = rosterQuery.gte("date", range.from).lte("date", range.to);

    const [{ data: homed }, { data: rostered }] = await Promise.all([
      admin.from("employees").select("id").eq("tenant_id", tenantId).in("site_id", siteIds),
      rosterQuery,
    ]);
    (homed ?? []).forEach((e) => visible.add(e.id as string));
    (rostered ?? []).forEach((r) => visible.add(r.employee_id as string));
  }

  // Never yourself: a supervisor's own attendance belongs to their manager.
  visible.delete(employee.id);

  return { unrestricted: false, employeeIds: [...visible], siteIds, selfEmployeeId };
});

/**
 * May this caller approve a request belonging to `targetEmployeeId`, for work
 * on `onDate` (YYYY-MM-DD)?
 *
 * Authority is evaluated against the site the target was assigned to ON THAT
 * DATE, so a roster change afterwards never moves an already-filed request to
 * a supervisor who did not witness the work.
 *
 * A manager can approve anywhere in their subtree -- the client's "Arun is the
 * ultimate authority, but in practice Priya approves her own reportees".
 */
export async function canApproveFor(
  ctx: Pick<WfmContext, "tenantId" | "role" | "employee" | "isSupervisor">,
  targetEmployeeId: string,
  onDate: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { tenantId, role, employee, isSupervisor } = ctx;

  // Nobody approves their own request, including a tenant admin. The
  // separation-of-duties rule is the point; "I am also the admin" is not an
  // exemption from it.
  if (employee && employee.id === targetEmployeeId) {
    return { ok: false, reason: "You can't approve your own request — it goes to your manager." };
  }

  if (role === "admin") return { ok: true };
  if (!isSupervisor) return { ok: false, reason: "Forbidden" };
  if (!employee) return { ok: true }; // wfm-granted login with no employee record

  const admin = createAdminSupabase();

  // Where was the target actually assigned on that date? An explicit roster
  // row wins; otherwise their standing home site.
  const { data: rosterRow } = await admin
    .from("wfm_roster_assignments")
    .select("site_id")
    .eq("tenant_id", tenantId)
    .eq("employee_id", targetEmployeeId)
    .eq("date", onDate)
    .maybeSingle();

  let siteId: string | null = (rosterRow?.site_id as string | null) ?? null;
  if (!siteId) {
    const { data: target } = await admin
      .from("employees")
      .select("site_id")
      .eq("id", targetEmployeeId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    siteId = (target?.site_id as string | null) ?? null;
  }

  const treeIds = [employee.id, ...(await descendantSupervisors(admin, tenantId, employee.id))];

  // The target may be a supervisor in my subtree rather than site staff --
  // that is how a manager approves their own supervisors' overtime.
  if (treeIds.includes(targetEmployeeId)) return { ok: true };

  if (!siteId) {
    return {
      ok: false,
      reason: "That employee isn't assigned to any site, so nobody supervises them — set their site first.",
    };
  }

  const { data: site } = await admin
    .from("wfm_sites")
    .select("id, name, supervisor_id")
    .eq("id", siteId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!site?.supervisor_id) {
    return {
      ok: false,
      reason: `${site?.name ?? "That site"} has no supervisor assigned — set one in Settings → Workforce → Sites.`,
    };
  }

  if (treeIds.includes(site.supervisor_id as string)) return { ok: true };

  return { ok: false, reason: "That employee doesn't work at a site you supervise." };
}

/** Apply a scope to a Supabase query builder's employee_id column. */
export function applyScope<T extends { in: (col: string, vals: string[]) => T }>(
  query: T,
  scope: WfmScope
): T {
  if (scope.unrestricted) return query;
  return query.in("employee_id", scope.employeeIds ?? []);
}

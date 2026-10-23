import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmployeeImpact } from "./employeeImpactText";

export { describeImpact, type EmployeeImpact } from "./employeeImpactText";

// What deleting an employee would destroy. The foreign keys from every WFM
// table to employees are ON DELETE CASCADE, so one DELETE silently removes the
// person's punches, leave, corrections and overtime (the BIM incident,
// 2026-10-23). This is the single source for both the dialog's counts
// (GET /api/employees/[id]/impact) and the server-side delete guard.
//
// Setup rows that also cascade but hold no work (face enrolments, push
// subscriptions, bank details, per-employee quotas, site approver and project
// links, alert history) are deliberately not counted: they never block a
// delete, and an employee with only those has nothing a report would miss.

const COUNTED: { key: keyof Omit<EmployeeImpact, "first_punch" | "last_punch" | "total">; table: string }[] = [
  { key: "punches", table: "wfm_presence_events" },
  { key: "leave_records", table: "wfm_leave_records" },
  { key: "leave_requests", table: "wfm_leave_requests" },
  { key: "corrections", table: "wfm_correction_requests" },
  { key: "overtime_sessions", table: "wfm_ot_sessions" },
  { key: "recheck_requests", table: "wfm_recheck_requests" },
  { key: "advance_requests", table: "wfm_advance_requests" },
  { key: "clarifications", table: "wfm_clarification_threads" },
  { key: "roster_entries", table: "wfm_roster_assignments" },
];

type DbError = { code?: string; message: string } | null;

// A table whose migration was never applied reads as zero rows (CLAUDE.md
// 3b: degrade cleanly), 42P01 from Postgres and PGRST205 from PostgREST's
// schema cache. Any other error rethrows: the delete guard must fail closed.
const isMissingTable = (e: DbError) => !!e && (e.code === "42P01" || e.code === "PGRST205");

async function countRows(admin: SupabaseClient, tenantId: string, employeeId: string, table: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId);
  if (error) {
    if (isMissingTable(error)) return 0;
    throw new Error(`${table}: ${error.message}`);
  }
  return count ?? 0;
}

async function punchEdge(admin: SupabaseClient, tenantId: string, employeeId: string, ascending: boolean): Promise<string | null> {
  const { data, error } = await admin
    .from("wfm_presence_events")
    .select("ts")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .order("ts", { ascending })
    .limit(1);
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`wfm_presence_events: ${error.message}`);
  }
  return ((data ?? [])[0]?.ts as string | undefined) ?? null;
}

/**
 * Counts everything delete would cascade away. Pass the ADMIN client: the
 * WFM tables' read policies are "own rows or supervisor", so a session client
 * could under-count for an admin who is not that person's supervisor and let a
 * delete through. Every query carries the explicit tenant filter.
 */
export async function loadEmployeeImpact(admin: SupabaseClient, tenantId: string, employeeId: string): Promise<EmployeeImpact> {
  const counts = await Promise.all(COUNTED.map((c) => countRows(admin, tenantId, employeeId, c.table)));
  const impact: EmployeeImpact = {
    punches: 0, first_punch: null, last_punch: null, leave_records: 0, leave_requests: 0, corrections: 0,
    overtime_sessions: 0, recheck_requests: 0, advance_requests: 0, clarifications: 0, roster_entries: 0, total: 0,
  };
  COUNTED.forEach((c, i) => { impact[c.key] = counts[i]; });
  impact.total = counts.reduce((a, b) => a + b, 0);
  if (impact.punches > 0) {
    [impact.first_punch, impact.last_punch] = await Promise.all([
      punchEdge(admin, tenantId, employeeId, true),
      punchEdge(admin, tenantId, employeeId, false),
    ]);
  }
  return impact;
}

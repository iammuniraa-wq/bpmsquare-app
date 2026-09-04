import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Shared payload builders for the WFM screens' bootstrap data -- each one
// produces EXACTLY what the corresponding /api/wfm/* GET route returns, and
// is used by both that route (the client-side refresh path) and the page's
// server component (the initial render), same split as lib/wfm/meState.ts.
// This is what lets the supervisor pages paint real data on first load
// instead of an empty shell that fetches after hydration.
//
// All functions take the caller's SESSION client (RLS is the backstop) plus
// the explicit tenant filter (defense in depth per MULTI_TENANT_GUARDRAILS).
// The ones that embed the supervisor-shaped select (employee name joins)
// must only ever be called from supervisor-gated contexts -- every page
// using them sits behind requireWfmSupervisorPage, and every route behind
// requireWfmSupervisor / requireWfm's isSupervisor branch.

function orThrow<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export async function wfmEmployeesPayload(supabase: SupabaseClient, tenantId: string) {
  const [empRes, { data: memberships }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, employee_code, first_name, last_name, phone, status, employment_type, wfm_role, shift_id, site_id, supervisor_id, consent_recorded_at, custom_data, wfm_shifts(name), wfm_sites!site_id(name)"
      )
      .eq("tenant_id", tenantId)
      .order("employee_code"),
    supabase
      .from("tenant_users")
      .select("employee_id, user_id")
      .eq("tenant_id", tenantId)
      .not("employee_id", "is", null),
  ]);
  const employees = orThrow(empRes);
  const linked = new Set((memberships ?? []).map((m) => m.employee_id));
  // Surface only the login User ID from custom_data (the rest of custom_data
  // isn't needed by this screen and needn't be shipped to the client).
  return employees.map(({ custom_data, ...e }) => ({
    ...e,
    has_login: linked.has(e.id),
    login_username: ((custom_data ?? {}) as { login_username?: string }).login_username ?? null,
  }));
}

export async function wfmShiftsPayload(supabase: SupabaseClient, tenantId: string) {
  return orThrow(
    await supabase
      .from("wfm_shifts")
      .select("id, name, start_time, end_time, grace_minutes, is_night_shift, night_allowance_amount, crosses_midnight, active")
      .eq("tenant_id", tenantId)
      .order("start_time")
  );
}

export async function wfmSitesPayload(supabase: SupabaseClient, tenantId: string) {
  // The supervisor's name is joined in so the Sites screen can show WHO runs
  // each site without a second round-trip and without the client having to
  // resolve ids against the employee list itself.
  return orThrow(
    await supabase
      .from("wfm_sites")
      .select("id, name, lat, lng, radius_m, active, created_at, supervisor_id, supervisor:employees!supervisor_id(first_name, last_name, employee_code)")
      .eq("tenant_id", tenantId)
      .order("name")
  );
}

export async function wfmLeaveTypesPayload(supabase: SupabaseClient, tenantId: string) {
  const [typesRes, { data: quotas }] = await Promise.all([
    supabase.from("wfm_leave_types").select("id, name, category, active").eq("tenant_id", tenantId).order("name"),
    supabase.from("wfm_leave_quotas").select("leave_type_id, annual_quota").eq("tenant_id", tenantId).is("employee_id", null),
  ]);
  const types = orThrow(typesRes);
  const quotaByType = new Map((quotas ?? []).map((q) => [q.leave_type_id, q.annual_quota]));
  return types.map((t) => ({ ...t, annual_quota: quotaByType.get(t.id) ?? 0 }));
}

export async function wfmLeaveRecordsPayload(supabase: SupabaseClient, tenantId: string, employeeId?: string | null) {
  let query = supabase
    .from("wfm_leave_records")
    .select("id, employee_id, leave_type_id, date_from, date_to, half_day, remarks, created_at, employees(first_name, last_name, employee_code), wfm_leave_types(name, category)")
    .eq("tenant_id", tenantId)
    .order("date_from", { ascending: false });
  if (employeeId) query = query.eq("employee_id", employeeId);
  return orThrow(await query);
}

/** Supervisor-shaped select (includes employee identity join). */
export async function wfmLeaveRequestsPayload(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { status?: string | null; employeeId?: string | null } = {}
) {
  let query = supabase
    .from("wfm_leave_requests")
    .select("*, employees(first_name, last_name, employee_code), wfm_leave_types(name, category)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
  if (opts.status) query = query.eq("status", opts.status);
  return orThrow(await query);
}

/** Supervisor-shaped select (includes employee identity join). */
export async function wfmCorrectionsPayload(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { status?: string | null; employeeId?: string | null } = {}
) {
  let query = supabase
    .from("wfm_correction_requests")
    .select("*, employees(first_name, last_name, employee_code)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
  if (opts.status) query = query.eq("status", opts.status);
  return orThrow(await query);
}

/** Supervisor-shaped select (includes employee identity join). */
export async function wfmRecheckPayload(
  supabase: SupabaseClient,
  tenantId: string,
  opts: { status?: string | null; employeeId?: string | null } = {}
) {
  let query = supabase
    .from("wfm_recheck_requests")
    .select("*, employees(first_name, last_name, employee_code)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (opts.employeeId) query = query.eq("employee_id", opts.employeeId);
  if (opts.status) query = query.eq("status", opts.status);
  return orThrow(await query);
}

export async function wfmRosterPayload(
  supabase: SupabaseClient,
  tenantId: string,
  from: string,
  to: string,
  employeeId?: string | null
) {
  const BASE =
    "id, employee_id, date, shift_id, site_id, is_day_off, note, " +
    "wfm_shifts(name, start_time, end_time, is_night_shift), wfm_sites(name), " +
    "employees(first_name, last_name, employee_code)";

  const run = (select: string) => {
    let q = supabase
      .from("wfm_roster_assignments")
      .select(select)
      .eq("tenant_id", tenantId)
      .gte("date", from)
      .lte("date", to)
      .order("date");
    if (employeeId) q = q.eq("employee_id", employeeId);
    return q;
  };

  // Project costing (0104) is attempted first and falls back on ANY error.
  // This payload is what the Roster page server-renders, so it must not be
  // able to fail on a database where 0104 hasn't run -- and equally must not
  // silently omit the project, which is how the Roster came to show a blank
  // Project column after a reload while the same data was present via the
  // API. One select or the other; never a half-populated row.
  const withProject = await run(`${BASE}, project_id, wfm_projects(name)`);
  if (!withProject.error) return withProject.data ?? [];
  return orThrow(await run(BASE));
}

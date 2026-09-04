import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, requireWfmSupervisor } from "@/lib/wfm/server";
import { tenantHasFeature } from "@/lib/tenant";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BULK_DATES = 62;
const MAX_EMPLOYEES = 500;
const MAX_ROWS = 3000; // employee_ids.length * dates.length

// GET /api/wfm/roster?from=YYYY-MM-DD&to=YYYY-MM-DD[&employee_id=] — a
// date-range slice of the roster. Supervisors can pass employee_id to
// scope to one person (or omit it for everyone); a plain employee always
// gets only their own rows regardless of what they pass.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId, employee, isSupervisor } = ctx;

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!from || !DATE_RE.test(from) || !to || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 });
  }

  let query = supabase
    .from("wfm_roster_assignments")
    .select(
      "id, employee_id, date, shift_id, site_id, is_day_off, note, " +
      "wfm_shifts(name, start_time, end_time, is_night_shift), wfm_sites(name), " +
      "employees(first_name, last_name, employee_code)"
    )
    .eq("tenant_id", tenantId)
    .gte("date", from)
    .lte("date", to)
    .order("date");

  if (!isSupervisor) {
    if (!employee) return NextResponse.json({ error: "No employee profile" }, { status: 403 });
    query = query.eq("employee_id", employee.id);
  } else {
    const employeeId = request.nextUrl.searchParams.get("employee_id");
    if (employeeId) query = query.eq("employee_id", employeeId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Project attribution (0104) is fetched SEPARATELY rather than joined into
  // the query above, so a tenant whose database hasn't had 0104 applied yet
  // still gets a working roster instead of a 42703 on a column that doesn't
  // exist. The roster is a live screen for existing WFM clients -- it must
  // not depend on a migration the owner runs by hand.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  if (rows.length > 0 && (await tenantHasFeature(supabase, tenantId, "wfm_projects"))) {
    const { data: projects } = await supabase
      .from("wfm_roster_assignments")
      .select("id, project_id, wfm_projects(name)")
      .eq("tenant_id", tenantId)
      .in("id", rows.map((r) => r.id as string));
    const byId = new Map((projects ?? []).map((p) => [p.id as string, p]));
    for (const row of rows) {
      const p = byId.get(row.id as string);
      const project = p?.wfm_projects as { name?: string } | { name?: string }[] | null | undefined;
      row.project_id = p?.project_id ?? null;
      row.project_name = (Array.isArray(project) ? project[0]?.name : project?.name) ?? null;
    }
  }

  return NextResponse.json(rows);
}

// POST /api/wfm/roster — supervisor/admin assigns (or clears) a shift for
// MANY employees across one or more dates in one call -- a bulk exception
// on top of everyone's standing shift (see PATCH /api/wfm/employees/bulk-shift
// for the standing-shift assignment itself). Upserts on
// (tenant_id, employee_id, date) -- re-assigning a date just overwrites it.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, userId } = ctx;

  const body = await request.json().catch(() => null);
  const { employee_ids, dates, shift_id, site_id, project_id, is_day_off, note } = (body ?? {}) as {
    employee_ids?: string[]; dates?: string[]; shift_id?: string | null; site_id?: string | null;
    project_id?: string | null; is_day_off?: boolean; note?: string;
  };

  if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
    return NextResponse.json({ error: "employee_ids must be a non-empty array" }, { status: 400 });
  }
  if (employee_ids.length > MAX_EMPLOYEES) {
    return NextResponse.json({ error: `Assign at most ${MAX_EMPLOYEES} employees at once` }, { status: 400 });
  }
  if (!Array.isArray(dates) || dates.length === 0 || dates.some((d) => !DATE_RE.test(d))) {
    return NextResponse.json({ error: "dates must be a non-empty array of YYYY-MM-DD strings" }, { status: 400 });
  }
  if (dates.length > MAX_BULK_DATES) {
    return NextResponse.json({ error: `Assign at most ${MAX_BULK_DATES} dates at once` }, { status: 400 });
  }
  if (employee_ids.length * dates.length > MAX_ROWS) {
    return NextResponse.json({ error: `That's too many employee × date combinations at once (max ${MAX_ROWS}) -- split into smaller batches` }, { status: 400 });
  }
  // A project-only override is legitimate: assigning someone to a job for a
  // week without touching their shift. makeShiftResolver treats a roster row
  // with no shift and is_day_off=false as "silent about the shift" and falls
  // back to the standing one, so this cannot turn into an accidental day off.
  if (!is_day_off && !shift_id && !project_id) {
    return NextResponse.json(
      { error: "Choose a shift, a project, or mark the day off" },
      { status: 400 }
    );
  }

  const admin = createAdminSupabase();

  const { data: foundEmployees, error: empErr } = await admin
    .from("employees").select("id").eq("tenant_id", tenantId).in("id", employee_ids);
  if (empErr) return NextResponse.json({ error: empErr.message }, { status: 500 });
  if ((foundEmployees ?? []).length !== employee_ids.length) {
    return NextResponse.json({ error: "One or more employees weren't found in this tenant" }, { status: 400 });
  }

  if (shift_id) {
    const { data: shift } = await admin
      .from("wfm_shifts").select("id").eq("id", shift_id).eq("tenant_id", tenantId).maybeSingle();
    if (!shift) return NextResponse.json({ error: "Unknown shift" }, { status: 400 });
  }
  if (site_id) {
    const { data: site } = await admin
      .from("wfm_sites").select("id").eq("id", site_id).eq("tenant_id", tenantId).maybeSingle();
    if (!site) return NextResponse.json({ error: "Unknown site" }, { status: 400 });
  }
  // Tenant-verified like every other foreign id from a request body. Only
  // accepted when the tenant actually has project costing, so a stray field
  // can't write attribution into a tenant that doesn't use it.
  const projectsOn = await tenantHasFeature(ctx.supabase, tenantId, "wfm_projects");
  if (project_id && projectsOn) {
    const { data: project } = await admin
      .from("wfm_projects").select("id").eq("id", project_id).eq("tenant_id", tenantId).maybeSingle();
    if (!project) return NextResponse.json({ error: "Unknown project" }, { status: 400 });
  }

  const rows = employee_ids.flatMap((employee_id) =>
    dates.map((date) => ({
      tenant_id: tenantId,
      employee_id,
      date,
      shift_id: is_day_off ? null : shift_id || null,
      site_id: site_id || null,
      // A day off has no work to attribute, so it never carries a project.
      ...(projectsOn ? { project_id: is_day_off ? null : project_id || null } : {}),
      is_day_off: is_day_off === true,
      note: note?.trim() || null,
      created_by: userId,
    }))
  );

  const { data, error } = await admin
    .from("wfm_roster_assignments")
    .upsert(rows, { onConflict: "tenant_id,employee_id,date" })
    .select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ applied: data?.length ?? 0 });
}

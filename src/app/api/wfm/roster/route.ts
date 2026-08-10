import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, requireWfmSupervisor } from "@/lib/wfm/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BULK_DATES = 62;

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
    .select("id, employee_id, date, shift_id, site_id, is_day_off, note, wfm_shifts(name, start_time, end_time, is_night_shift), wfm_sites(name)")
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
  return NextResponse.json(data ?? []);
}

// POST /api/wfm/roster — supervisor/admin assigns (or clears) a shift for
// one employee on one or more dates in one call. Upserts on
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
  const { employee_id, dates, shift_id, site_id, is_day_off, note } = (body ?? {}) as {
    employee_id?: string; dates?: string[]; shift_id?: string | null; site_id?: string | null;
    is_day_off?: boolean; note?: string;
  };

  if (!employee_id) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  if (!Array.isArray(dates) || dates.length === 0 || dates.some((d) => !DATE_RE.test(d))) {
    return NextResponse.json({ error: "dates must be a non-empty array of YYYY-MM-DD strings" }, { status: 400 });
  }
  if (dates.length > MAX_BULK_DATES) {
    return NextResponse.json({ error: `Assign at most ${MAX_BULK_DATES} dates at once` }, { status: 400 });
  }
  if (!is_day_off && !shift_id) {
    return NextResponse.json({ error: "shift_id is required unless is_day_off is set" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  const { data: employee } = await admin
    .from("employees").select("id").eq("id", employee_id).eq("tenant_id", tenantId).maybeSingle();
  if (!employee) return NextResponse.json({ error: "Unknown employee" }, { status: 400 });

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

  const rows = dates.map((date) => ({
    tenant_id: tenantId,
    employee_id,
    date,
    shift_id: is_day_off ? null : shift_id,
    site_id: site_id || null,
    is_day_off: is_day_off === true,
    note: note?.trim() || null,
    created_by: userId,
  }));

  const { data, error } = await admin
    .from("wfm_roster_assignments")
    .upsert(rows, { onConflict: "tenant_id,employee_id,date" })
    .select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

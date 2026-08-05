import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/wfm/leave-records — admin-entered leave, optionally ?employee_id=.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId } = ctx;
  const employeeId = request.nextUrl.searchParams.get("employee_id");

  let query = supabase
    .from("wfm_leave_records")
    .select("id, employee_id, leave_type_id, date_from, date_to, half_day, remarks, created_at, employees(first_name, last_name, employee_code), wfm_leave_types(name, category)")
    .eq("tenant_id", tenantId)
    .order("date_from", { ascending: false });
  if (employeeId) query = query.eq("employee_id", employeeId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/wfm/leave-records — admin enters a leave record for an employee.
// v1 has no employee self-application workflow (spec §9.2) -- this is the
// only way leave gets recorded, same admin-entered pattern as manual punches.
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
  const { employee_id, leave_type_id, date_from, date_to, half_day, remarks } = (body ?? {}) as {
    employee_id?: string; leave_type_id?: string; date_from?: string; date_to?: string;
    half_day?: boolean; remarks?: string;
  };
  if (!employee_id || !leave_type_id || !date_from || !date_to || !DATE_RE.test(date_from) || !DATE_RE.test(date_to)) {
    return NextResponse.json({ error: "employee_id, leave_type_id, date_from and date_to are required" }, { status: 400 });
  }
  if (date_to < date_from) {
    return NextResponse.json({ error: "date_to cannot be before date_from" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Client-supplied foreign ids must resolve inside this tenant.
  const [{ data: employee }, { data: leaveType }] = await Promise.all([
    admin.from("employees").select("id").eq("id", employee_id).eq("tenant_id", tenantId).maybeSingle(),
    admin.from("wfm_leave_types").select("id").eq("id", leave_type_id).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!employee) return NextResponse.json({ error: "Unknown employee" }, { status: 400 });
  if (!leaveType) return NextResponse.json({ error: "Unknown leave type" }, { status: 400 });

  const { data, error } = await admin
    .from("wfm_leave_records")
    .insert({
      tenant_id: tenantId,
      employee_id,
      leave_type_id,
      date_from,
      date_to,
      half_day: half_day === true,
      remarks: remarks?.trim() || null,
      entered_by: userId,
    })
    .select("id, employee_id, leave_type_id, date_from, date_to, half_day, remarks")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

import { NextResponse, type NextRequest } from "next/server";
import { requireWfm } from "@/lib/wfm/server";

// GET /api/wfm/ot-sessions — overtime sessions.
//   * supervisor: every employee's, optionally filtered by ?status= / ?employee_id=
//   * employee:   only their own (same shape as corrections/leave-requests)
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId, employee, isSupervisor } = ctx;
  const status = request.nextUrl.searchParams.get("status");
  const employeeIdParam = request.nextUrl.searchParams.get("employee_id");

  let query = supabase
    .from("wfm_ot_sessions")
    .select(
      isSupervisor
        ? "*, employees(first_name, last_name, employee_code)"
        : "*"
    )
    .eq("tenant_id", tenantId)
    .order("ot_date", { ascending: false })
    .order("started_at", { ascending: false });

  if (!isSupervisor) {
    if (!employee) return NextResponse.json({ error: "No employee profile" }, { status: 403 });
    query = query.eq("employee_id", employee.id);
  } else if (employeeIdParam) {
    query = query.eq("employee_id", employeeIdParam);
  }
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

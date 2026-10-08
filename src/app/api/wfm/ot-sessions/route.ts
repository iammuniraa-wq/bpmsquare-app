import { NextResponse, type NextRequest } from "next/server";
import { requireWfm } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

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
  } else {
    // A supervisor's queue is their own subtree, not the whole tenant: the
    // site(s) they run plus anything under supervisors reporting to them.
    const scope = await resolveWfmScope(ctx);
    if (!scope.unrestricted) query = query.in("employee_id", scope.employeeIds ?? []);
    if (employeeIdParam) query = query.eq("employee_id", employeeIdParam);
  }
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

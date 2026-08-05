import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, requireWfmEmployee } from "@/lib/wfm/server";
import type { LeaveRequestStatus } from "@/lib/wfm/types";

const STATUSES: LeaveRequestStatus[] = ["pending", "approved", "rejected"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/wfm/leave-requests — supervisors see the tenant queue (optionally
// ?status=pending); everyone else sees only their own requests. Mirrors
// GET /api/wfm/corrections exactly.
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

  let query = supabase
    .from("wfm_leave_requests")
    .select(
      isSupervisor
        ? "*, employees(first_name, last_name, employee_code), wfm_leave_types(name, category)"
        : "*, wfm_leave_types(name, category)"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (!isSupervisor) {
    if (!employee) return NextResponse.json({ error: "No employee profile" }, { status: 403 });
    query = query.eq("employee_id", employee.id);
  }
  if (status && STATUSES.includes(status as LeaveRequestStatus)) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/wfm/leave-requests — an employee requests leave. Never writes
// to wfm_leave_records itself — only a supervisor approval does that, via
// PATCH .../leave-requests/[id].
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, employee } = ctx;

  const body = await request.json().catch(() => null);
  const { leave_type_id, date_from, date_to, half_day, reason_text } = (body ?? {}) as {
    leave_type_id?: string; date_from?: string; date_to?: string;
    half_day?: boolean; reason_text?: string;
  };

  if (!leave_type_id) return NextResponse.json({ error: "leave_type_id is required" }, { status: 400 });
  if (!date_from || !DATE_RE.test(date_from) || !date_to || !DATE_RE.test(date_to)) {
    return NextResponse.json({ error: "date_from and date_to (YYYY-MM-DD) are required" }, { status: 400 });
  }
  if (date_to < date_from) {
    return NextResponse.json({ error: "date_to cannot be before date_from" }, { status: 400 });
  }
  if (!reason_text?.trim()) {
    return NextResponse.json({ error: "reason_text is required" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Client-supplied leave_type_id must resolve to a real, active type in
  // this tenant -- same guardrail as leave-records' admin-entry path.
  const { data: leaveType } = await admin
    .from("wfm_leave_types")
    .select("id")
    .eq("id", leave_type_id)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .maybeSingle();
  if (!leaveType) return NextResponse.json({ error: "Unknown leave type" }, { status: 400 });

  const { data, error } = await admin
    .from("wfm_leave_requests")
    .insert({
      tenant_id: tenantId,
      employee_id: employee.id,
      leave_type_id,
      date_from,
      date_to,
      half_day: half_day === true,
      reason_text: reason_text.trim(),
    })
    .select("*, wfm_leave_types(name, category)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

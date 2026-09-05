import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, requireWfmEmployee, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getSupervisorEmails, sendWfmNotification } from "@/lib/wfm/notify";
import { loadLeaveType, monthlyLimitError } from "@/lib/wfm/leaveServer";
import { ROUTES } from "@/lib/constants";
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
  const employeeIdParam = request.nextUrl.searchParams.get("employee_id");

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
  } else {
    // A supervisor's queue is their own subtree, not the whole tenant: the
    // site(s) they run plus anything under supervisors reporting to them.
    const scope = await resolveWfmScope(ctx);
    if (!scope.unrestricted) query = query.in("employee_id", scope.employeeIds ?? []);
    if (employeeIdParam) query = query.eq("employee_id", employeeIdParam);
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
  const leaveType = await loadLeaveType(admin, tenantId, leave_type_id, true);
  if (!leaveType) return NextResponse.json({ error: "Unknown leave type" }, { status: 400 });

  // Monthly limit (0109): approved records plus still-pending requests of
  // this type count against the month, so two requests cannot both squeeze
  // through before a supervisor looks.
  const limitError = await monthlyLimitError(admin, tenantId, employee.id, leaveType, { date_from, date_to, half_day: half_day === true });
  if (limitError) return NextResponse.json({ error: limitError }, { status: 400 });

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

  const config = await getWfmConfig(admin, tenantId);
  if (config.notifications.leave_pending) {
    const empName = [employee.first_name, employee.last_name].filter(Boolean).join(" ");
    const emails = await getSupervisorEmails(admin, tenantId, employee.id);
    sendWfmNotification({
      sessionSupabase: ctx.supabase,
      tenantId,
      toEmails: emails,
      subject: `Leave request from ${empName} — ${date_from} to ${date_to}`,
      text: `${empName} has requested leave from ${date_from} to ${date_to}.\n\nReason: ${reason_text.trim()}`,
      link: { path: ROUTES.wfmLeave, label: "Review it here" },
      relatedObjectType: "wfm_leave_requests",
      relatedObjectId: data.id,
      relatedObjectLabel: `${empName} — ${date_from} to ${date_to}`,
    }).catch(() => {});
  }

  return NextResponse.json(data);
}

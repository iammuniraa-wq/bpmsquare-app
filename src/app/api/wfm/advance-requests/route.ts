import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, requireWfmEmployee, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getSupervisorEmails, sendWfmNotification } from "@/lib/wfm/notify";
import { ROUTES } from "@/lib/constants";
import type { AdvanceRequestKind, AdvanceRequestStatus } from "@/lib/wfm/types";

const KINDS: AdvanceRequestKind[] = ["ot", "wfh"];
const STATUSES: AdvanceRequestStatus[] = ["pending", "approved", "rejected"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_LABEL: Record<AdvanceRequestKind, string> = { ot: "overtime", wfh: "work from home" };

// GET /api/wfm/advance-requests — advance OT/WFH notice. Supervisors see
// their subtree's queue (optionally ?status=/?kind=/?employee_id=);
// everyone else sees only their own. Mirrors GET /api/wfm/leave-requests.
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
  const kind = request.nextUrl.searchParams.get("kind");
  const employeeIdParam = request.nextUrl.searchParams.get("employee_id");

  let query = supabase
    .from("wfm_advance_requests")
    .select(isSupervisor ? "*, employees(first_name, last_name, employee_code)" : "*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (!isSupervisor) {
    if (!employee) return NextResponse.json({ error: "No employee profile" }, { status: 403 });
    query = query.eq("employee_id", employee.id);
  } else {
    const scope = await resolveWfmScope(ctx);
    if (!scope.unrestricted) query = query.in("employee_id", scope.employeeIds ?? []);
    if (employeeIdParam) query = query.eq("employee_id", employeeIdParam);
  }
  if (status && STATUSES.includes(status as AdvanceRequestStatus)) query = query.eq("status", status);
  if (kind && KINDS.includes(kind as AdvanceRequestKind)) query = query.eq("kind", kind);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/wfm/advance-requests — an employee gives advance notice of OT,
// or requests WFH. Neither writes anywhere else on submit -- OT is notice
// only (the payable session is wfm_ot_sessions, created when OT is actually
// punched); WFH's only effect is being consulted by the punch route once
// approved (isWfhApprovedForDate, lib/wfm/advanceRequests.ts).
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
  const { kind, date_from, date_to, reason_text } = (body ?? {}) as {
    kind?: string; date_from?: string; date_to?: string; reason_text?: string;
  };

  if (!kind || !KINDS.includes(kind as AdvanceRequestKind)) {
    return NextResponse.json({ error: "kind must be 'ot' or 'wfh'" }, { status: 400 });
  }
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
  const { data, error } = await admin
    .from("wfm_advance_requests")
    .insert({
      tenant_id: tenantId,
      employee_id: employee.id,
      kind,
      date_from,
      date_to,
      reason_text: reason_text.trim(),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const config = await getWfmConfig(admin, tenantId);
  if (config.notifications.advance_request_pending) {
    const empName = [employee.first_name, employee.last_name].filter(Boolean).join(" ");
    const emails = await getSupervisorEmails(admin, tenantId, employee.id);
    sendWfmNotification({
      sessionSupabase: ctx.supabase,
      tenantId,
      toEmails: emails,
      subject: `${KIND_LABEL[kind as AdvanceRequestKind]} request from ${empName} — ${date_from}${date_to !== date_from ? ` to ${date_to}` : ""}`,
      text: `${empName} has requested ${KIND_LABEL[kind as AdvanceRequestKind]} for ${date_from}${date_to !== date_from ? ` to ${date_to}` : ""}.\n\nReason: ${reason_text.trim()}`,
      link: { path: ROUTES.wfmMe, label: "Review it here" },
      relatedObjectType: "wfm_advance_requests",
      relatedObjectId: data.id,
      relatedObjectLabel: `${empName} — ${date_from}`,
    }).catch(() => {});
  }

  return NextResponse.json(data);
}

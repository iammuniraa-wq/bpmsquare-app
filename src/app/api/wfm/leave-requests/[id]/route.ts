import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { getEmployeeLoginEmail, sendWfmNotification } from "@/lib/wfm/notify";
import { ROUTES } from "@/lib/constants";
import { canApproveFor } from "@/lib/wfm/scope";

// PATCH /api/wfm/leave-requests/[id] — supervisor approves or rejects a
// pending request. Approve inserts a real wfm_leave_records row (the only
// thing that actually affects leave balance / monthly summary) rather than
// mutating the request into a leave record — mirrors
// PATCH /api/wfm/corrections/[id]'s "never edit in place" shape.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, userId } = ctx;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const { action, supervisor_remark } = (body ?? {}) as { action?: string; supervisor_remark?: string };
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }
  if (action === "reject" && !supervisor_remark?.trim()) {
    return NextResponse.json({ error: "supervisor_remark is required to reject" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // The decision reaches the employee, same as corrections. Leave is worse
  // to leave silent: someone waiting on an answer is deciding whether to
  // turn up. Fire-and-forget -- a mail failure must never fail an approval
  // that has already written its wfm_leave_records row.
  const notifyEmployee = async (
    employeeId: string,
    outcome: "approved" | "rejected",
    remark: string | null,
    typeName: string
  ) => {
    const config = await getWfmConfig(admin, tenantId);
    if (!config.notifications.leave_resolved) return;
    const email = await getEmployeeLoginEmail(admin, tenantId, employeeId);
    if (!email) return; // not every employee has a login
    const from = req!.date_from as string;
    const to = req!.date_to as string;
    const span = from === to
      ? `${from}${req!.half_day ? " (half day)" : ""}`
      : `${from} to ${to}`;
    await sendWfmNotification({
      sessionSupabase: ctx.supabase,
      tenantId,
      toEmails: [email],
      subject: `Your ${typeName} request for ${span} was ${outcome}`,
      text: outcome === "approved"
        ? `Your supervisor approved your ${typeName} request for ${span}.`
          + (remark ? `\n\nNote: "${remark}"` : "")
        : `Your supervisor could not approve your ${typeName} request for ${span}.`
          + `\n\nReason: "${remark ?? ""}"`,
      link: { path: ROUTES.wfmMe, label: "View your requests" },
      relatedObjectType: "wfm_leave_requests",
      relatedObjectId: id,
      relatedObjectLabel: span,
    });
  };

  // The joined row the update returns carries the type name; PostgREST gives
  // an embedded one-to-one back as either an object or a single-element array
  // depending on how it infers the relationship, so accept both.
  const typeNameOf = (row: unknown): string => {
    const t = (row as { wfm_leave_types?: { name?: string } | { name?: string }[] } | null)?.wfm_leave_types;
    const one = Array.isArray(t) ? t[0] : t;
    return one?.name ?? "leave";
  };

  const { data: req } = await admin
    .from("wfm_leave_requests")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!req) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.status !== "pending") {
    return NextResponse.json({ error: "Request has already been resolved" }, { status: 409 });
  }

  // Leave is judged against its FIRST day -- the request is one block, so it
  // needs one approver rather than a different one per day it spans.
  const allowed = await canApproveFor(ctx, req.employee_id as string, req.date_from as string);
  if (!allowed.ok) return NextResponse.json({ error: allowed.reason }, { status: 403 });

  if (action === "reject") {
    const { data, error } = await admin
      .from("wfm_leave_requests")
      .update({
        status: "rejected",
        supervisor_id: userId,
        supervisor_remark: supervisor_remark!.trim(),
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*, wfm_leave_types(name, category)")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    notifyEmployee(req.employee_id as string, "rejected", supervisor_remark!.trim(), typeNameOf(data)).catch(() => {});
    return NextResponse.json(data);
  }

  const { data: record, error: recordErr } = await admin
    .from("wfm_leave_records")
    .insert({
      tenant_id: tenantId,
      employee_id: req.employee_id,
      leave_type_id: req.leave_type_id,
      date_from: req.date_from,
      date_to: req.date_to,
      half_day: req.half_day,
      remarks: req.reason_text,
      entered_by: userId,
    })
    .select("id")
    .single();
  if (recordErr) return NextResponse.json({ error: recordErr.message }, { status: 500 });

  const { data, error } = await admin
    .from("wfm_leave_requests")
    .update({
      status: "approved",
      supervisor_id: userId,
      supervisor_remark: supervisor_remark?.trim() || null,
      resolved_at: new Date().toISOString(),
      leave_record_id: record.id,
    })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*, wfm_leave_types(name, category)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  notifyEmployee(req.employee_id as string, "approved", supervisor_remark?.trim() || null, typeNameOf(data)).catch(() => {});
  return NextResponse.json(data);
}

import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
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
  return NextResponse.json(data);
}

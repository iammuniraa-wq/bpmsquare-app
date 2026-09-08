import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { canApproveFor } from "@/lib/wfm/scope";

// PATCH /api/wfm/advance-requests/[id] — supervisor approves or rejects.
// Approving flips status only -- there's no side-effect record to write
// (unlike leave): OT stays notice-only, and WFH's whole effect is being
// consulted by the punch route (isWfhApprovedForDate) from this same row.
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
    .from("wfm_advance_requests")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!req) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.status !== "pending") {
    return NextResponse.json({ error: "Request has already been resolved" }, { status: 409 });
  }

  // Judged against the request's first day, same as leave's own request-is-
  // one-block reasoning.
  const allowed = await canApproveFor(ctx, req.employee_id as string, req.date_from as string);
  if (!allowed.ok) return NextResponse.json({ error: allowed.reason }, { status: 403 });

  const { data, error } = await admin
    .from("wfm_advance_requests")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      supervisor_id: userId,
      supervisor_remark: supervisor_remark?.trim() || null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

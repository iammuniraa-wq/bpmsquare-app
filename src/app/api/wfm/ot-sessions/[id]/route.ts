import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";

// PATCH /api/wfm/ot-sessions/[id] — supervisor approves or rejects one
// overtime session. Only approved sessions ever count toward payable hours
// or OT cost (see monthlySummary), so this route is the pay gate. Same
// shape as the corrections/leave approval routes.
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
  const { data: session } = await admin
    .from("wfm_ot_sessions")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.status !== "pending") {
    return NextResponse.json({ error: "This overtime session has already been resolved" }, { status: 409 });
  }

  const { data, error } = await admin
    .from("wfm_ot_sessions")
    .update({
      status: action === "approve" ? "approved" : "rejected",
      supervisor_remark: supervisor_remark?.trim() || null,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

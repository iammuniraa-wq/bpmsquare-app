import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import type { PresenceKind } from "@/lib/wfm/types";

// PATCH /api/wfm/corrections/[id] — supervisor approves or rejects a
// pending request. Approve never edits the original presence event (if
// any) — it inserts a new source=correction event and stamps
// superseded_by on the old one, per the append-only design (§2).
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
    .from("wfm_correction_requests")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!req) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.status !== "pending") {
    return NextResponse.json({ error: "Request has already been resolved" }, { status: 409 });
  }

  if (action === "reject") {
    const { data, error } = await admin
      .from("wfm_correction_requests")
      .update({
        status: "rejected",
        supervisor_id: userId,
        supervisor_remark: supervisor_remark!.trim(),
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  // Approve. requested_change carries {issue, proposed_ts?, kind?} — see
  // wfm/types.ts. "other" issues have no concrete kind/ts to act on; those
  // can only be approved as an administrative note (no event is written).
  const change = (req.requested_change ?? {}) as { issue?: string; proposed_ts?: string; kind?: PresenceKind };

  if (change.kind && change.proposed_ts) {
    const newEventId = crypto.randomUUID();
    const { error: insertErr } = await admin.from("wfm_presence_events").insert({
      id: newEventId,
      tenant_id: tenantId,
      employee_id: req.employee_id,
      ts: change.proposed_ts,
      kind: change.kind,
      source: "correction",
      created_by: userId,
    });
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

    if (req.target_event_id) {
      const { error: supersedeErr } = await admin
        .from("wfm_presence_events")
        .update({ superseded_by: newEventId })
        .eq("id", req.target_event_id)
        .eq("tenant_id", tenantId);
      if (supersedeErr) return NextResponse.json({ error: supersedeErr.message }, { status: 500 });
    }
  }

  const { data, error } = await admin
    .from("wfm_correction_requests")
    .update({
      status: "approved",
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

import { NextResponse, NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { isMissingSchema } from "@/lib/tender/server";
import { openTenderDealRequest, PENDING_BIDS } from "@/lib/tender/dealAccess";
import { CALL_KIND_LABEL, nextStepProblem, parseCallEdit } from "@/lib/tender/calls";
import { CALL_COLS, type CallRow } from "@/lib/tender/callsServer";

// PATCH  /api/opportunities/[id]/tender/calls/[callId] -- edit a logged contact, or tick its next step off ({ next_step_done: true }).
// DELETE /api/opportunities/[id]/tender/calls/[callId] -- remove it.
// Ticking a next step off is open to anyone who may edit the deal (the next step is the team's); editing or deleting the entry is for
// the person who logged it and for workspace admins.

const UUID = /^[0-9a-f-]{36}$/i;

async function load(admin: import("@supabase/supabase-js").SupabaseClient, tenantId: string, opportunityId: string, callId: string) {
  const { data, error } = await admin.from("deal_activities").select(CALL_COLS).eq("id", callId).eq("opportunity_id", opportunityId).eq("tenant_id", tenantId).maybeSingle();
  return { row: (data as CallRow | null) ?? null, error };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; callId: string }> }) {
  const { id, callId } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!UUID.test(callId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { admin, supabase, tenantId, userId, role, opp } = gate.req;
  const { row, error: loadError } = await load(admin, tenantId, id, callId);
  if (loadError) return NextResponse.json({ error: isMissingSchema(loadError) ? PENDING_BIDS : loadError.message }, { status: isMissingSchema(loadError) ? 503 : 500 });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = parseCallEdit(await request.json().catch(() => ({})), new Date());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const { next_step_done, ...fields } = parsed.value;
  const mine = role === "admin" || row.logged_by === userId;
  if (Object.keys(fields).length > 0 && !mine) return NextResponse.json({ error: "Only the person who logged this, or an admin, can change it" }, { status: 403 });

  const merged = { next_step: "next_step" in fields ? fields.next_step ?? null : row.next_step, next_step_due: "next_step_due" in fields ? fields.next_step_due ?? null : row.next_step_due };
  const problem = nextStepProblem(merged);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  const patch: Record<string, unknown> = { ...fields };
  if (next_step_done !== undefined) patch.next_step_done_at = next_step_done ? new Date().toISOString() : null;
  // A changed next step starts over: it is not done any more.
  if ("next_step" in fields && fields.next_step !== row.next_step && next_step_done === undefined) patch.next_step_done_at = null;

  const { error } = await admin.from("deal_activities").update(patch).eq("id", callId).eq("opportunity_id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  const changes = next_step_done !== undefined && Object.keys(fields).length === 0
    ? [{ field: "next step", from: row.next_step, to: next_step_done ? `${row.next_step ?? ""} (done)`.trim() : row.next_step }]
    : Object.entries(fields).map(([field, to]) => ({ field: `${CALL_KIND_LABEL[row.kind].toLowerCase()} ${field}`, from: (row as unknown as Record<string, unknown>)[field] ?? null, to: typeof to === "string" ? to.slice(0, 120) : to }));
  await logChange(supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
    actorId: user?.id ?? userId, actorEmail: user?.email, changes,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; callId: string }> }) {
  const { id, callId } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!UUID.test(callId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { admin, supabase, tenantId, userId, role, opp } = gate.req;
  const { row, error: loadError } = await load(admin, tenantId, id, callId);
  if (loadError) return NextResponse.json({ error: isMissingSchema(loadError) ? PENDING_BIDS : loadError.message }, { status: isMissingSchema(loadError) ? 503 : 500 });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (role !== "admin" && row.logged_by !== userId) return NextResponse.json({ error: "Only the person who logged this, or an admin, can remove it" }, { status: 403 });

  const { error } = await admin.from("deal_activities").delete().eq("id", callId).eq("opportunity_id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
    actorId: user?.id ?? userId, actorEmail: user?.email, changes: [{ field: `${CALL_KIND_LABEL[row.kind].toLowerCase()} removed`, from: row.summary.slice(0, 120), to: null }],
  });
  return new NextResponse(null, { status: 204 });
}

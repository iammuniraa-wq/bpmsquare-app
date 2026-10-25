import { NextResponse, NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { isMissingSchema } from "@/lib/tender/server";
import { openTenderDealRequest, PENDING_BIDS } from "@/lib/tender/dealAccess";
import { CALL_KIND_LABEL, CALL_LIMITS, nextStepProblem, parseNewCall } from "@/lib/tender/calls";
import { listCalls } from "@/lib/tender/callsServer";

// GET  /api/opportunities/[id]/tender/calls -- the calls, meetings, site visits and notes logged on a tender deal, newest first.
// POST /api/opportunities/[id]/tender/calls -- log one. Who logged it is the session's; the workspace is the session's.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId, userId, role } = gate.req;
  return NextResponse.json(await listCalls(admin, tenantId, id, { userId, isAdmin: role === "admin" }));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId, userId, opp } = gate.req;
  const parsed = parseNewCall(await request.json().catch(() => ({})), new Date());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const problem = nextStepProblem(parsed.value);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  const { count, error: countError } = await admin.from("deal_activities").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("opportunity_id", id);
  if (countError) return NextResponse.json({ error: isMissingSchema(countError) ? PENDING_BIDS : countError.message }, { status: isMissingSchema(countError) ? 503 : 500 });
  if ((count ?? 0) >= CALL_LIMITS.perDeal) return NextResponse.json({ error: `A deal can hold ${CALL_LIMITS.perDeal} logged contacts` }, { status: 409 });

  const { data, error } = await admin.from("deal_activities").insert({ tenant_id: tenantId, opportunity_id: id, ...parsed.value, logged_by: userId }).select("id").maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return NextResponse.json({ error: PENDING_BIDS }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update",
    actorId: user?.id ?? userId, actorEmail: user?.email,
    changes: [{ field: `${CALL_KIND_LABEL[parsed.value.kind].toLowerCase()} logged`, from: null, to: parsed.value.summary.slice(0, 120) }, ...(parsed.value.next_step ? [{ field: "next step", from: null, to: `${parsed.value.next_step}${parsed.value.next_step_due ? ` (due ${parsed.value.next_step_due})` : ""}` }] : [])],
  });
  return NextResponse.json({ ok: true, id: data?.id ?? null }, { status: 201 });
}

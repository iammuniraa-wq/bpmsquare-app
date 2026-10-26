import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { markReviewed, openEstimatesRequest, removeLink } from "@/lib/tender/estimates/server";

// One link between a BOQ line and an estimate output (migration 0227).
// DELETE         unlink: the line keeps its rate; with other links left it is priced from them, with none left it becomes a manual rate
// PATCH { reviewed: true }   "I looked at it": clears the review mark an RFQ award left when it re-priced the line

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { id, linkId } = await params;
  const gate = await openEstimatesRequest(id, "write");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const out = await removeLink(gate.req, linkId);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  const user = await getAuthUser();
  await logChange(gate.req.supabase, {
    tenantId: gate.req.tenantId, objectType: "opportunity_tenders", objectId: gate.req.opp.id, objectLabel: `${gate.req.opp.ref ?? ""} ${gate.req.opp.title}`.trim(), action: "update",
    actorId: user?.id, actorEmail: user?.email, changes: [{ field: "BOQ estimate link", from: "linked", to: "removed" }],
  });
  return NextResponse.json({ ok: true, repriced: out.repriced, failed: out.failed });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; linkId: string }> }) {
  const { id, linkId } = await params;
  const gate = await openEstimatesRequest(id, "write");
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await req.json().catch(() => null)) as { reviewed?: unknown } | null;
  if (body?.reviewed !== true) return NextResponse.json({ error: "Nothing to change" }, { status: 422 });
  const n = await markReviewed(gate.req, [linkId]);
  if (n === 0) return NextResponse.json({ error: "Link not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

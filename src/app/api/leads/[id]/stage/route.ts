import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";
import { setLeadStage } from "@/lib/marketing/leadStatus";
import { isLeadStageKey, stageDefOf } from "@/lib/marketing/leadStages";

// POST /api/leads/[id]/stage { stage, comment? } -- move a lead to one of the
// eight stages through the status engine (docs/marketing-platform-architecture.md
// 4.2). Part of the marketing_scoring program: answers 404 for any workspace
// without it, so nothing about it exists for a client that has not been given it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "leads"))) {
    return NextResponse.json({ error: "Leads aren't enabled for your workspace" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (!isLeadStageKey(body?.stage)) return NextResponse.json({ error: "stage must be one of the lead stages" }, { status: 400 });
  const comment = typeof body.comment === "string" && body.comment.trim() ? body.comment.trim().slice(0, 500) : null;

  const result = await setLeadStage({ tenantId, leadId: id, to: body.stage, userId, role: role === "admin" ? "admin" : "member", comment, source: "manual" });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  if (result.from !== result.stage) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "leads", objectId: id, objectLabel: null,
      action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: [{ field: "stage", from: stageDefOf(result.from).label, to: stageDefOf(result.stage).label }],
    });
  }
  return NextResponse.json({ stage: result.stage });
}

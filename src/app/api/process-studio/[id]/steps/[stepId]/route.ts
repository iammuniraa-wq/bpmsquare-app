import { NextResponse, type NextRequest } from "next/server";
import { parseStepPatch } from "@/lib/studio/requests";
import { studioAccess, errorResponse, ownedStudy, childOf } from "@/lib/studio/server";

// One step of the map. The step id comes from the URL and is re-checked
// against the study (childOf) before anything is written; an id from another
// study or tenant is simply "not found".
//
// PATCH  { name?, lane?, what?, how_today?, frequency?, hands_over?, assumed?, area?, sort_order? }
// DELETE -> the step, its fit row (cascade) and nothing else.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const { id, stepId } = await params;
    const study = await ownedStudy(ctx, id);
    const step = await childOf(ctx, "process_study_steps", study.id, stepId, "id");
    if (!step) return NextResponse.json({ error: "Step not found" }, { status: 404 });
    const parsed = parseStepPatch(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const { error } = await ctx.admin.from("process_study_steps")
      .update({ ...parsed.patch, updated_at: new Date().toISOString() })
      .eq("id", step.id).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; stepId: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const { id, stepId } = await params;
    const study = await ownedStudy(ctx, id);
    const step = await childOf(ctx, "process_study_steps", study.id, stepId, "id");
    if (!step) return NextResponse.json({ error: "Step not found" }, { status: 404 });
    const { error } = await ctx.admin.from("process_study_steps").delete()
      .eq("id", step.id).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { parseChangePatch } from "@/lib/studio/requests";
import { studioAccess, errorResponse, ownedStudy, childOf } from "@/lib/studio/server";

// One proposed change: hide it ("we can live without this") or put it back;
// edit the wording of one the client added. The band is not editable here.
//
// PATCH  { kept?, title?, plain? }   (title / plain only on a change the client added)
// DELETE -> only a change the client added

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; changeId: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const { id, changeId } = await params;
    const study = await ownedStudy(ctx, id);
    const change = await childOf<{ id: string; client_added: boolean }>(ctx, "process_study_changes", study.id, changeId, "id, client_added");
    if (!change) return NextResponse.json({ error: "Change not found" }, { status: 404 });
    const parsed = parseChangePatch(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const patch = { ...parsed.patch };
    if (!change.client_added) { delete patch.title; delete patch.plain; }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Only the changes you added can be reworded." }, { status: 422 });
    const { error } = await ctx.admin.from("process_study_changes")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", change.id).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; changeId: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const { id, changeId } = await params;
    const study = await ownedStudy(ctx, id);
    const change = await childOf<{ id: string; client_added: boolean }>(ctx, "process_study_changes", study.id, changeId, "id, client_added");
    if (!change) return NextResponse.json({ error: "Change not found" }, { status: 404 });
    if (!change.client_added) return NextResponse.json({ error: "Hide it instead: only a change you added can be deleted." }, { status: 409 });
    const { error } = await ctx.admin.from("process_study_changes").delete()
      .eq("id", change.id).eq("tenant_id", ctx.tenantId).eq("study_id", study.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

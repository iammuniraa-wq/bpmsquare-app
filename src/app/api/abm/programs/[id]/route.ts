import { NextResponse, type NextRequest } from "next/server";
import { abmAccess, errorResponse, loadProgram, pendingResponse, isTenantMember } from "@/lib/abm/server";
import { parseProgram } from "@/lib/abm/requests";
import { diffForLog, logChange } from "@/lib/changeLog";
import { emitEvent } from "@/lib/events/emit";
import { EVENTS } from "@/lib/events/catalog";

// One ABM program. PATCH takes an explicit allowlist (parseProgram); status moves
// draft -> active -> paused -> completed -> archived by PATCH { status }.
// DELETE removes the program and, by cascade, its targets and buying groups.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("view");
    const { id } = await params;
    const { data, missing } = await loadProgram(ctx, id);
    if (missing) return pendingResponse();
    if (!data) return NextResponse.json({ error: "Program not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("edit");
    const { id } = await params;
    const { data: before, missing } = await loadProgram(ctx, id);
    if (missing) return pendingResponse();
    if (!before) return NextResponse.json({ error: "Program not found" }, { status: 404 });

    const parsed = parseProgram(await req.json().catch(() => null), false);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const patch: Record<string, unknown> = { ...parsed.value };
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 422 });
    if (parsed.value.owner_user_id && !(await isTenantMember(ctx, parsed.value.owner_user_id))) {
      return NextResponse.json({ error: "The owner must be a member of this workspace." }, { status: 422 });
    }
    const starts = (patch.starts_on as string | null | undefined) ?? before.starts_on;
    const ends = (patch.ends_on as string | null | undefined) ?? before.ends_on;
    if (starts && ends && ends < starts) return NextResponse.json({ error: "The program cannot end before it starts." }, { status: 422 });

    const { data, error } = await ctx.supabase.from("abm_programs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id).eq("tenant_id", ctx.tenantId).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const changes = diffForLog("abm_programs", before as unknown as Record<string, unknown>, patch);
    if (changes.length > 0) {
      await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "abm_programs", objectId: id, objectLabel: before.name, action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes });
      await emitEvent(ctx.tenantId, {
        name: EVENTS.ABM_PROGRAM_UPDATED, object_type: "abm_program", object_id: id, actor_id: ctx.userId,
        key: `${id}:updated:${new Date().toISOString().slice(0, 16)}`, payload: { fields: changes.map((c) => c.field), status: (patch.status as string | undefined) ?? before.status },
      }, ctx.admin);
    }
    return NextResponse.json(data);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await abmAccess("delete");
    const { id } = await params;
    const { data: snap, missing } = await loadProgram(ctx, id);
    if (missing) return pendingResponse();
    if (!snap) return NextResponse.json({ error: "Program not found" }, { status: 404 });

    const { error } = await ctx.supabase.from("abm_programs").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "abm_programs", objectId: id, objectLabel: snap.name, action: "delete", actorId: ctx.userId, actorEmail: ctx.email });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return errorResponse(e);
  }
}

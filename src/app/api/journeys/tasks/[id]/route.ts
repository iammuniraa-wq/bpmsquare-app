import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { errorResponse, journeyAccess } from "@/lib/marketing/journeys/access";

// PATCH /api/journeys/tasks/[id] { status: "done" } -> marks a journey task done. Only the person it is assigned to,
// or an admin, may; a task nobody owns can be completed by anyone who can edit journeys. Tasks are select-only
// for members in the database, so this is the only way one changes.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await journeyAccess("view");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { status?: unknown };
    if (body.status !== "done") return NextResponse.json({ error: "Only marking a task done is supported." }, { status: 422 });
    const { data } = await ctx.admin.from("journey_tasks").select("id, owner_user_id, title, status").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
    const t = data as { id: string; owner_user_id: string | null; title: string; status: string } | null;
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (t.owner_user_id && t.owner_user_id !== ctx.userId && ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!t.owner_user_id && !ctx.can.edit && ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await ctx.admin.from("journey_tasks").update({ status: "done", done_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", ctx.tenantId);
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "journeys", objectId: id, objectLabel: t.title, action: "update", actorId: ctx.userId, changes: [{ field: "task", from: "open", to: "done" }] });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { parseSave } from "@/lib/newsletter/requests";
import { errorResponse, newsletterAccess, ownedBundle, saveNewsletter, pendingResponse } from "@/lib/newsletter/server";

// GET    /api/newsletters/[id]   -> the newsletter, its language rows and its versions
// PATCH  /api/newsletters/[id]   -> a full or partial save (explicit allowlist in parseSave)
// DELETE /api/newsletters/[id]   -> only a newsletter nobody has taken a version of; otherwise archive it

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await newsletterAccess("view");
    const { id } = await params;
    return NextResponse.json(await ownedBundle(ctx, id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await newsletterAccess("edit");
    const { id } = await params;
    const parsed = parseSave(await req.json().catch(() => null), { creating: false });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const saved = await saveNewsletter(ctx, id, parsed.value);
    if ("missing" in saved) return pendingResponse();
    return NextResponse.json({ id: saved.id, ref: saved.ref, warnings: saved.warnings });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await newsletterAccess("delete");
    const { id } = await params;
    const b = await ownedBundle(ctx, id);
    if (b.versions.length > 0) {
      return NextResponse.json({ error: "A campaign may have used this design, so it can't be deleted. Archive it instead." }, { status: 409 });
    }
    const { error } = await ctx.supabase.from("newsletters").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
    if (error) return NextResponse.json({ error: "Could not delete the newsletter" }, { status: 500 });
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "newsletters", objectId: id, objectLabel: b.newsletter.ref ?? b.newsletter.name,
      action: "delete", actorId: ctx.userId, actorEmail: ctx.email,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

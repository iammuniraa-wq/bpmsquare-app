import { NextResponse, type NextRequest } from "next/server";
import { isUuid, moduleAccess, moduleErrorResponse, pendingMessage } from "@/lib/marketing/moduleAccess";
import { WHATSAPP_SPEC, deleteTemplate, loadTemplate, saveTemplate } from "@/lib/marketing/whatsapp/server";

// GET    /api/whatsapp/templates/[id]  -> the template (this workspace's only; another's reads like a missing one)
// PATCH  /api/whatsapp/templates/[id]  { content?: {name, language, category, body, topic}, status?, rejection_reason? }
//          The words pass the sanitiser; the approval flag is admin-only; changing the words of an approved
//          template sends it back to draft.
// DELETE /api/whatsapp/templates/[id]  -> a template nothing was sent from is deleted; otherwise it is archived

const pending = () => NextResponse.json({ error: pendingMessage(WHATSAPP_SPEC), pending_migration: true }, { status: 503 });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await moduleAccess(WHATSAPP_SPEC, "view");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const r = await loadTemplate(ctx, id);
    if (r.missing) return pending();
    if (!r.data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json(r.data);
  } catch (e) {
    return moduleErrorResponse(WHATSAPP_SPEC, e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await moduleAccess(WHATSAPP_SPEC, "edit");
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const saved = await saveTemplate(ctx, id, { content: body?.content, status: body?.status, rejection_reason: body?.rejection_reason });
    if ("missing" in saved) return pending();
    return NextResponse.json({ id, status: saved.status });
  } catch (e) {
    return moduleErrorResponse(WHATSAPP_SPEC, e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await moduleAccess(WHATSAPP_SPEC, "delete");
    const { id } = await params;
    const r = await deleteTemplate(ctx, id);
    if (r === "missing") return pending();
    if (r === "not_found") return NextResponse.json({ error: "Template not found" }, { status: 404 });
    return NextResponse.json({ ok: true, archived: r === "archived" });
  } catch (e) {
    return moduleErrorResponse(WHATSAPP_SPEC, e);
  }
}

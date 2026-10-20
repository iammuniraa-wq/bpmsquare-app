import { NextResponse, type NextRequest } from "next/server";
import { deleteForm, errorResponse, formsAccess, isUuid, loadForm, pendingResponse, saveForm } from "@/lib/marketing/forms/server";

// GET    /api/marketing-forms/[id]  -> the form (this workspace's only; another's answers like a missing one)
// PATCH  /api/marketing-forms/[id]  -> a full save; the allowlist and every sanitiser live in sanitizeFormSave()
// DELETE /api/marketing-forms/[id]  -> only a form nobody has submitted; otherwise archive it

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await formsAccess("view");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Form not found" }, { status: 404 });
    const r = await loadForm(ctx, id);
    if (r.missing) return pendingResponse();
    if (!r.data) return NextResponse.json({ error: "Form not found" }, { status: 404 });
    return NextResponse.json(r.data);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await formsAccess("edit");
    const { id } = await params;
    const saved = await saveForm(ctx, id, await req.json().catch(() => null));
    if ("missing" in saved) return pendingResponse();
    return NextResponse.json({ id, warnings: saved.warnings });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await formsAccess("delete");
    const { id } = await params;
    const r = await deleteForm(ctx, id);
    if (r === "missing") return pendingResponse();
    if (r === "not_found") return NextResponse.json({ error: "Form not found" }, { status: 404 });
    if (r === "has_submissions") return NextResponse.json({ error: "This form has answers, so it can't be deleted. Archive it instead." }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

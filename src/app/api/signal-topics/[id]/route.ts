import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, isUuid, signalsAccess } from "@/lib/signals/access";
import { deleteTopic, parseTopic, updateTopic } from "@/lib/signals/topics";

// PATCH  /api/signal-topics/[id] { name?, keywords?, enabled? } (admin) -- explicit field allowlist in parseTopic
// DELETE /api/signal-topics/[id] (admin)
// The id is matched together with the caller's tenant, so another tenant's id simply is not found.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await signalsAccess("admin");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const parsed = parseTopic(await req.json().catch(() => null), true);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const r = await updateTopic(ctx, id, parsed.value);
    return r.ok ? NextResponse.json({ topic: r.value }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await signalsAccess("admin");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const r = await deleteTopic(ctx, id);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
  } catch (e) {
    return errorResponse(e);
  }
}

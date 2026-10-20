import { NextResponse, type NextRequest } from "next/server";
import { isUuid, moduleAccess, moduleErrorResponse, pendingMessage } from "@/lib/marketing/moduleAccess";
import { EVENTS_SPEC, deleteEvent, loadEvent, saveEvent } from "@/lib/marketing/events/server";

// GET    /api/marketing-events/[id]  -> the event (this workspace's only; another's reads like a missing one)
// PATCH  /api/marketing-events/[id]  -> a full save; every value passes sanitizeEvent() and the foreign ids are checked
// DELETE /api/marketing-events/[id]  -> an event nobody registered for is deleted; otherwise it is cancelled

const pending = () => NextResponse.json({ error: pendingMessage(EVENTS_SPEC), pending_migration: true }, { status: 503 });

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await moduleAccess(EVENTS_SPEC, "view");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    const r = await loadEvent(ctx, id);
    if (r.missing) return pending();
    if (!r.data) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    return NextResponse.json(r.data);
  } catch (e) {
    return moduleErrorResponse(EVENTS_SPEC, e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await moduleAccess(EVENTS_SPEC, "edit");
    const { id } = await params;
    const saved = await saveEvent(ctx, id, await req.json().catch(() => null));
    if ("missing" in saved) return pending();
    return NextResponse.json({ id });
  } catch (e) {
    return moduleErrorResponse(EVENTS_SPEC, e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await moduleAccess(EVENTS_SPEC, "delete");
    const { id } = await params;
    const r = await deleteEvent(ctx, id);
    if (r === "missing") return pending();
    if (r === "not_found") return NextResponse.json({ error: "Event not found" }, { status: 404 });
    return NextResponse.json({ ok: true, cancelled: r === "cancelled" });
  } catch (e) {
    return moduleErrorResponse(EVENTS_SPEC, e);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { moduleAccess, moduleErrorResponse } from "@/lib/marketing/moduleAccess";
import { EVENTS_SPEC, moveRegistration } from "@/lib/marketing/events/server";

// PATCH /api/marketing-events/[id]/registrations/[rid] { status } -- check in (attended), mark as not coming
// (no_show), cancel, or register again. The registration is found by its id, this event AND this workspace.
// Attendance is final (409): events, journeys and reports have already seen it.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  try {
    const ctx = await moduleAccess(EVENTS_SPEC, "edit");
    const { id, rid } = await params;
    const b = (await req.json().catch(() => null)) as { status?: unknown } | null;
    const r = await moveRegistration(ctx, id, rid, b?.status);
    return NextResponse.json({ status: r.status });
  } catch (e) {
    return moduleErrorResponse(EVENTS_SPEC, e);
  }
}

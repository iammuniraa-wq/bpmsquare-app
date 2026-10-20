import { NextResponse, type NextRequest } from "next/server";
import { moduleAccess, moduleErrorResponse } from "@/lib/marketing/moduleAccess";
import { EVENTS_SPEC, startFollowUp } from "@/lib/marketing/events/server";

// POST /api/marketing-events/[id]/follow-up -- starts the event's chosen journey for the people the event names
// (those who came, or those who did not), once each. The journey must be live; it is the journey's own rules that
// decide what, if anything, is sent. The journey is found by id AND this workspace.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await moduleAccess(EVENTS_SPEC, "edit");
    const { id } = await params;
    return NextResponse.json(await startFollowUp(ctx, id));
  } catch (e) {
    return moduleErrorResponse(EVENTS_SPEC, e);
  }
}

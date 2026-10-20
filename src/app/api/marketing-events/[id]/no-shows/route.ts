import { NextResponse, type NextRequest } from "next/server";
import { moduleAccess, moduleErrorResponse } from "@/lib/marketing/moduleAccess";
import { EVENTS_SPEC, markRemainingNoShows } from "@/lib/marketing/events/server";

// POST /api/marketing-events/[id]/no-shows -- after the event has started, everyone still "registered" is marked
// as not having come. Refused (409) before the event starts.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await moduleAccess(EVENTS_SPEC, "edit");
    const { id } = await params;
    return NextResponse.json(await markRemainingNoShows(ctx, id));
  } catch (e) {
    return moduleErrorResponse(EVENTS_SPEC, e);
  }
}

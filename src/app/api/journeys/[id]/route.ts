import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, journeyAccess } from "@/lib/marketing/journeys/access";
import { loadJourneyRow } from "@/lib/marketing/journeys/store";
import { removeJourney, updateJourney } from "@/lib/marketing/journeys/service";

// GET    /api/journeys/[id]   -> the journey
// PATCH  /api/journeys/[id] { name?, definition? } -> the saved journey. The definition passes sanitizeJourney();
//                              a live journey must be paused first.
// DELETE /api/journeys/[id]   -> deleted if it never ran, otherwise archived

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await journeyAccess("view");
    const { id } = await params;
    const j = await loadJourneyRow(ctx.admin, ctx.tenantId, id);
    if (!j) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ journey: j });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await journeyAccess("edit");
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { name?: unknown; definition?: unknown } | null;
    if (!body) return NextResponse.json({ error: "Nothing to save." }, { status: 422 });
    // Explicit allowlist: nothing but these two fields is ever read from the body.
    const journey = await updateJourney(ctx, id, { name: body.name, definition: body.definition });
    return NextResponse.json({ journey });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await journeyAccess("delete");
    const { id } = await params;
    return NextResponse.json({ result: await removeJourney(ctx, id) });
  } catch (e) {
    return errorResponse(e);
  }
}

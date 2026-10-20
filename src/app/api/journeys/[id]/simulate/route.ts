import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, journeyAccess } from "@/lib/marketing/journeys/access";
import { sanitizeJourney } from "@/lib/marketing/journeys/definition";
import { simulateJourney } from "@/lib/marketing/journeys/simulate";
import { loadJourneyRow } from "@/lib/marketing/journeys/store";
import { isUuid } from "@/lib/newsletter/requests";

// POST /api/journeys/[id]/simulate { contact_id, definition? } -> the path that person would take, with the reason at every turn.
// Nothing is sent, recorded or emitted. `definition` lets the screen try steps it has not saved yet; it goes through the same sanitiser.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await journeyAccess("view");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { contact_id?: unknown; definition?: unknown };
    if (typeof body.contact_id !== "string" || !isUuid(body.contact_id)) return NextResponse.json({ error: "Pick a person." }, { status: 422 });
    const j = await loadJourneyRow(ctx.admin, ctx.tenantId, id);
    if (!j) return NextResponse.json({ error: "Not found" }, { status: 404 });
    let def = j.definition;
    if (body.definition !== undefined) {
      const s = sanitizeJourney(body.definition);
      if (!s.ok) return NextResponse.json({ error: s.errors[0] }, { status: 422 });
      def = s.definition;
    }
    const r = await simulateJourney(ctx.admin, ctx.env, def, body.contact_id);
    if (!r) return NextResponse.json({ error: "That person could not be found." }, { status: 404 });
    return NextResponse.json(r);
  } catch (e) {
    return errorResponse(e);
  }
}

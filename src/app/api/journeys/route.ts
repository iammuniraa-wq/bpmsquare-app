import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, journeyAccess } from "@/lib/marketing/journeys/access";
import { listJourneyRows } from "@/lib/marketing/journeys/store";
import { createJourney } from "@/lib/marketing/journeys/service";

// Journeys (0165-0169, docs/shells/journeys-shell.md).
//
// GET  /api/journeys           -> { journeys: [{ id, ref, name, status, trigger_name, steps, updated_at }] }
// POST /api/journeys { name?, template? } -> 201 { id, ref }   (the "Quote follow-up" template or a blank one)

export async function GET() {
  try {
    const ctx = await journeyAccess("view");
    const r = await listJourneyRows(ctx.admin, ctx.tenantId);
    return NextResponse.json({
      journeys: r.rows.map((j) => ({ id: j.id, ref: j.ref, name: j.name, status: j.status, trigger_name: j.trigger_name, steps: j.definition.steps.length, updated_at: j.updated_at })),
      ...(r.missing ? { pending_migration: true } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await journeyAccess("create");
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; template?: unknown };
    const made = await createJourney(ctx, { name: typeof body.name === "string" ? body.name : "", template: typeof body.template === "string" ? body.template : "blank" });
    return NextResponse.json(made, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

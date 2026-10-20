import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, journeyAccess } from "@/lib/marketing/journeys/access";
import { goLiveChecks } from "@/lib/marketing/journeys/preview";
import { loadJourneyRow } from "@/lib/marketing/journeys/store";

// GET /api/journeys/[id]/preview -> who would enter today (count and the first ten, by the same rules the runner
// enrols with) and the messages shown before Turn on. Reads only: nothing is enrolled, sent or recorded.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await journeyAccess("view");
    const { id } = await params;
    const j = await loadJourneyRow(ctx.admin, ctx.tenantId, id);
    if (!j) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const r = await goLiveChecks(ctx.admin, ctx.env, j, new Date());
    return NextResponse.json({
      entry: { count: r.entry.count, first: r.entry.first, lookback_days: r.entry.lookbackDays, at_least: r.entry.atLeast },
      checks: r.checks, needs_confirm: r.needsConfirm,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

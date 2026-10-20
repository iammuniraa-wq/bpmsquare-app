import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, journeyAccess } from "@/lib/marketing/journeys/access";
import { setJourneyStatus } from "@/lib/marketing/journeys/service";

// POST /api/journeys/[id]/status { action: "turn_on" | "pause", confirm?: boolean }
//   -> 200 { status, enrolled }
//   -> 409 { needs_confirm: true, checks }  when turning on would enrol more people than the workspace's limit
//      and the caller has not confirmed.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await journeyAccess("edit");
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { action?: unknown; confirm?: unknown };
    if (body.action !== "turn_on" && body.action !== "pause") return NextResponse.json({ error: "Say whether to turn it on or pause it." }, { status: 422 });
    const r = await setJourneyStatus(ctx, id, body.action, body.confirm === true);
    if ("needsConfirm" in r) return NextResponse.json({ needs_confirm: true, checks: r.checks }, { status: 409 });
    return NextResponse.json(r);
  } catch (e) {
    return errorResponse(e);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { studioAccess, errorResponse, ownedStudy } from "@/lib/studio/server";
import { runBuildMap } from "@/lib/studio/run";

export const maxDuration = 120;

// Step 2: "Build my process map" -- one call over the whole conversation.
// Replaces the steps (and everything built on them), so when steps already exist
// the first call answers 409 { confirm_required } and the screen asks.
//
// POST { confirm? } -> { steps, warnings }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const study = await ownedStudy(ctx, (await params).id);
    const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
    return NextResponse.json(await runBuildMap(ctx, study, body?.confirm === true));
  } catch (e) {
    return errorResponse(e);
  }
}

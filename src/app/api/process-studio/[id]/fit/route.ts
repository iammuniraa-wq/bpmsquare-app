import { NextResponse, type NextRequest } from "next/server";
import { studioAccess, errorResponse, ownedStudy } from "@/lib/studio/server";
import { runFit } from "@/lib/studio/run";

export const maxDuration = 300;

// Step 3: "Check the fit" -- one call per area, each ground in the catalogue
// slice for that area and every rating checked by code afterwards
// (lib/studio/ratings.ts). Re-running keeps the previous result as a version.
//
// POST -> { rows, warnings }

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const study = await ownedStudy(ctx, (await params).id);
    return NextResponse.json(await runFit(ctx, study));
  } catch (e) {
    return errorResponse(e);
  }
}

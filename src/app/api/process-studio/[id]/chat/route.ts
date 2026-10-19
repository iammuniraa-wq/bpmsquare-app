import { NextResponse, type NextRequest } from "next/server";
import { parseChat } from "@/lib/studio/requests";
import { studioAccess, errorResponse, ownedStudy } from "@/lib/studio/server";
import { runChat } from "@/lib/studio/run";

export const maxDuration = 60;

// Step 1: one client message, one studio reply with up to three follow-up
// questions and the chips of what it understood. The message cap and the monthly
// AI allowance are enforced before the model is called (lib/studio/caps.ts,
// lib/ai/structured.ts); the client's message is kept even if the reply fails.
//
// POST { text, area? } -> { client, studio }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await studioAccess("edit");
    const study = await ownedStudy(ctx, (await params).id);
    const parsed = parseChat(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    return NextResponse.json(await runChat(ctx, study, parsed.value.text, parsed.value.area));
  } catch (e) {
    return errorResponse(e);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { estimatorAccess, errorResponse } from "@/lib/estimator/server";
import { aiConfigured, EstimatorAiError, notConfiguredResponse, meteredAsk, ESTIMATE_PICK_SURFACE } from "@/lib/estimator/aiServer";
import { runPick } from "@/lib/estimator/aiRun";

// POST { text } -- read a pasted email and say which of THIS workspace's templates it needs.
// Returns { configured, template_id | null, name, confidence, level, alternatives[<=3], not_sure, reason }.
// template_id is null when the AI is not sure: the person chooses, nothing is guessed.
// The model is sent only the template list (name, description, keywords, input labels) and
// the email; no prices or rules. Nothing is saved or created. Needs estimate-create access
// (it costs a model call) and counts against the workspace's AI allowance (surface
// "estimate_pick"). 503 { configured: false } when no AI key is set.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { supabase, tenantId, userId } = await estimatorAccess("create");
    if (!aiConfigured()) return notConfiguredResponse();
    const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
    const r = await runPick({
      supabase, tenantId, text: typeof body?.text === "string" ? body.text : "",
      ask: meteredAsk({ tenantId, userId }, ESTIMATE_PICK_SURFACE, 1200),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ configured: true, ...r.result });
  } catch (e) {
    if (e instanceof EstimatorAiError) return NextResponse.json({ error: e.message, configured: e.status !== 503 }, { status: e.status });
    return errorResponse(e);
  }
}

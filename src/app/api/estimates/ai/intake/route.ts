import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/estimator/requests";
import { estimatorAccess, errorResponse } from "@/lib/estimator/server";
import { aiConfigured, EstimatorAiError, notConfiguredResponse, meteredAsk, ESTIMATE_INTAKE_SURFACE } from "@/lib/estimator/aiServer";
import { runIntake } from "@/lib/estimator/aiRun";

// POST { template_id, text } -- read a pasted brief or email against the chosen template and
// PROPOSE a value for each input, each marked found | likely | missing with the email's own
// words (`fields`). `values` holds only found and likely inputs; a missing input never gets a
// number. Nothing is saved: the new-estimate page fills its fields for the user to review.
// Needs estimate-create access (it costs a model call) and counts against the workspace's AI
// allowance (surface "estimate_intake"). Text only; 503 { configured: false } when no AI key is set.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { supabase, tenantId, userId } = await estimatorAccess("create");
    if (!aiConfigured()) return notConfiguredResponse();
    const body = (await req.json().catch(() => null)) as { template_id?: unknown; text?: unknown } | null;
    if (!isUuid(body?.template_id)) return NextResponse.json({ error: "Choose a template first." }, { status: 422 });
    const r = await runIntake({
      supabase, tenantId, templateId: body!.template_id as string, text: typeof body?.text === "string" ? body.text : "",
      ask: meteredAsk({ tenantId, userId }, ESTIMATE_INTAKE_SURFACE, 4000),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ configured: true, ...r.proposal });
  } catch (e) {
    if (e instanceof EstimatorAiError) return NextResponse.json({ error: e.message, configured: e.status !== 503 }, { status: e.status });
    return errorResponse(e);
  }
}

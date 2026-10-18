import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/estimator/requests";
import { estimatorAccess, errorResponse, pendingResponse, loadEstimateBundle } from "@/lib/estimator/server";
import { aiConfigured, askStructured, EstimatorAiError, notConfiguredResponse } from "@/lib/estimator/aiServer";
import { buildReviewPrompt, clampReview, REVIEW_SCHEMA } from "@/lib/estimator/ai";
import { buildReviewFacts } from "@/lib/estimator/aiFacts";

// POST -- ask for a short list of risks and missing items on the stored
// estimate, in words. Sends quantities, groups and totals only (no unit costs).
// Nothing is saved or changed. Needs estimate-edit access (it costs a model
// call). 503 { configured: false } when no AI key is set.
export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, tenantId } = await estimatorAccess("edit");
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    if (!aiConfigured()) return notConfiguredResponse();
    const { bundle, missing } = await loadEstimateBundle(supabase, tenantId, id);
    if (missing) return pendingResponse();
    if (!bundle) return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    if (bundle.lines.length === 0) return NextResponse.json({ error: "Calculate the estimate before asking for a review." }, { status: 422 });

    const facts = buildReviewFacts(bundle.estimate, bundle.lines, bundle.template);
    const raw = await askStructured(buildReviewPrompt(facts), REVIEW_SCHEMA as Record<string, unknown>);
    return NextResponse.json({ configured: true, saved: false, ...clampReview(raw) });
  } catch (e) {
    if (e instanceof EstimatorAiError) return NextResponse.json({ error: e.message, configured: e.status !== 503 }, { status: e.status });
    return errorResponse(e);
  }
}

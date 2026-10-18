import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/estimator/requests";
import { estimatorAccess, errorResponse, pendingResponse, loadTemplate } from "@/lib/estimator/server";
import { aiConfigured, askStructured, EstimatorAiError, notConfiguredResponse } from "@/lib/estimator/aiServer";
import { buildIntakePrompt, clampIntake, intakeSchema, MAX_BRIEF_CHARS } from "@/lib/estimator/ai";

// POST { template_id, text } -- read a pasted brief or email and PROPOSE input
// values for the chosen template. Nothing is saved: the new-estimate form fills
// its fields for the user to review. Needs estimate-create access (it costs a
// model call). Text only; 503 { configured: false } when no AI key is set.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const { supabase, tenantId } = await estimatorAccess("create");
    if (!aiConfigured()) return notConfiguredResponse();
    const body = (await req.json().catch(() => null)) as { template_id?: unknown; text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return NextResponse.json({ error: "Paste the brief or email first." }, { status: 400 });
    if (text.length > MAX_BRIEF_CHARS) return NextResponse.json({ error: `That is too long to read (limit ${MAX_BRIEF_CHARS.toLocaleString("en-GB")} characters). Paste the relevant part.` }, { status: 413 });
    if (!isUuid(body?.template_id)) return NextResponse.json({ error: "Choose a template first." }, { status: 422 });

    const tpl = await loadTemplate(supabase, tenantId, body.template_id as string);
    if (tpl.missing) return pendingResponse();
    if (!tpl.data) return NextResponse.json({ error: "Template not found" }, { status: 404 });
    const inputs = tpl.data.inputs ?? [];
    if (inputs.length === 0) return NextResponse.json({ error: "This template has no inputs to fill in." }, { status: 422 });

    const raw = await askStructured(buildIntakePrompt(tpl.data.name, inputs, text), intakeSchema(inputs));
    return NextResponse.json({ configured: true, ...clampIntake(inputs, raw) });
  } catch (e) {
    if (e instanceof EstimatorAiError) return NextResponse.json({ error: e.message, configured: e.status !== 503 }, { status: e.status });
    return errorResponse(e);
  }
}

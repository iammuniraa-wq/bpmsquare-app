import { NextResponse, type NextRequest } from "next/server";
import { checkTemplate, checkFormula } from "@/lib/estimator/editorCheck";
import { estimatorAccess, errorResponse } from "@/lib/estimator/server";

// POST /api/estimate-templates/validate { geometry?, inputs, rates, rules, formula? }
// For the template editor. Nothing is saved.
//   -> { ok, issues, warnings, example, example_issues, formula? }
// `example` is the template worked out with its default inputs and a zero margin (product
// rules have no price here, so `unpriced` lists them); `formula` (when sent) is
// { ok, errors, unknown, value, note } for that one expression in this template's names.
const MAX_BODY_BYTES = 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    await estimatorAccess("edit");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "The template is too large to check." }, { status: 413 });
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "A JSON body is required." }, { status: 422 });
    const template = { geometry: body.geometry, inputs: body.inputs, rates: body.rates, rules: body.rules };
    const check = checkTemplate(template);
    const formula = typeof body.formula === "string" ? checkFormula(template, body.formula.slice(0, 2000)) : undefined;
    return NextResponse.json({ ...check, ...(formula ? { formula } : {}) });
  } catch (e) {
    return errorResponse(e);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { draftStandardQuoteLines, StandardQuoteAIError } from "@/lib/standardQuoteAI";

// Suggestion-only -- never writes anything. Returns description/uom/qty for
// review in the form; the salesperson always fills in the real rate.
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "standard_quotes"))) {
    return NextResponse.json({ error: "Standard Quotes isn't enabled for your workspace" }, { status: 403 });
  }

  const body = await request.json();
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : "";
  if (!description) return NextResponse.json({ error: "description is required" }, { status: 400 });

  try {
    const lines = await draftStandardQuoteLines(description);
    return NextResponse.json({ lines });
  } catch (e) {
    if (e instanceof StandardQuoteAIError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error("[standard-quotes/ai-draft-lines] unexpected error", e);
    return NextResponse.json({ error: "AI drafting failed" }, { status: 500 });
  }
}

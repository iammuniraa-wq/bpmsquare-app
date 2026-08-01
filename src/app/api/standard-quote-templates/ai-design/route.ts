import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { designStandardQuoteTemplate, StandardQuoteAIError } from "@/lib/standardQuoteAI";
import { sanitizeStandardQuoteBlocks, HEX_COLOR_RE, LOGO_POSITIONS } from "@/lib/standardQuoteTemplateBlocks";

// Suggestion-only -- never writes anything, and the AI's output is run
// through the exact same sanitizer the real PATCH route uses before it's
// returned, so a malformed/hallucinated response can't hand the client
// anything the template builder or print document doesn't already know how
// to render safely.
export async function POST(request: NextRequest) {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : "";
  if (!description) return NextResponse.json({ error: "description is required" }, { status: 400 });

  try {
    const design = await designStandardQuoteTemplate(description);
    const accentColor = typeof design.accent_color === "string" && HEX_COLOR_RE.test(design.accent_color) ? design.accent_color : null;
    const logoPosition = LOGO_POSITIONS.has(design.logo_position ?? "") ? design.logo_position : "left";
    const blocks = sanitizeStandardQuoteBlocks(design.blocks);
    return NextResponse.json({ accent_color: accentColor, logo_position: logoPosition, blocks });
  } catch (e) {
    if (e instanceof StandardQuoteAIError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error("[standard-quote-templates/ai-design] unexpected error", e);
    return NextResponse.json({ error: "AI design failed" }, { status: 500 });
  }
}

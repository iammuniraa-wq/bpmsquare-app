import { NextResponse, type NextRequest } from "next/server";
import { aiRewrite } from "@/lib/newsletter/aiServer";
import { parseRewrite } from "@/lib/newsletter/requests";
import { errorResponse, newsletterAccess } from "@/lib/newsletter/server";

// POST /api/newsletters/ai/rewrite { text, tone: shorter | warmer | formal, lang, field? }
//   -> { text } or { text: null, kept: true } when the rewrite dropped a {{token}}.
// The rewrite replaces words in the editor with Undo available; nothing is saved here.

export async function POST(req: NextRequest) {
  try {
    const ctx = await newsletterAccess("edit");
    const parsed = parseRewrite(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const out = await aiRewrite(
      { tenantId: ctx.tenantId, userId: ctx.userId, config: ctx.config },
      { text: parsed.text, tone: parsed.tone, lang: parsed.lang, companyName: ctx.tenantName, maxLen: parsed.field === "text" || parsed.field === "p1" || parsed.field === "p2" ? 4000 : 400 },
    );
    if (!out) return NextResponse.json({ text: null, kept: true, message: "The rewrite changed a field that is replaced for each person, so your words were kept." });
    return NextResponse.json({ text: out.text });
  } catch (e) {
    return errorResponse(e);
  }
}

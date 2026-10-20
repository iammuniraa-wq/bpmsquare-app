import { NextResponse, type NextRequest } from "next/server";
import { aiTranslate } from "@/lib/newsletter/aiServer";
import { parseTranslate } from "@/lib/newsletter/requests";
import { languageStatus } from "@/lib/newsletter/sanitize";
import { TEXT_FIELDS, directionOf, type LanguageRow } from "@/lib/newsletter/types";
import { errorResponse, newsletterAccess, ownedBundle, pendingResponse, upsertLanguage } from "@/lib/newsletter/server";

// POST /api/newsletters/[id]/translate { lang, mode?: "ai" | "empty" }
// Adds a language on top of the English. "ai" translates every block (one string per
// field, with a glossary) and marks every block "translated": a person must accept each
// before the language can be sent. "empty" adds a row to be written by hand, with the
// same rule. The call is metered (ai_usage_log) and answers "AI is not set up" without a key.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await newsletterAccess("edit");
    const { id } = await params;
    const b = await ownedBundle(ctx, id);
    const parsed = parseTranslate(await req.json().catch(() => null), b.newsletter.source_language);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    if (b.languages.some((l) => l.lang === parsed.target)) return NextResponse.json({ error: "That language is already there." }, { status: 409 });
    const source = b.languages.find((l) => l.lang === b.newsletter.source_language);
    if (!source) return NextResponse.json({ error: "The English words are missing." }, { status: 422 });

    let row: LanguageRow;
    let kept: string[] = [];
    if (parsed.empty) {
      const review: LanguageRow["review"] = {};
      for (const blk of b.newsletter.blocks) review[blk.id] = TEXT_FIELDS[blk.type].some((f) => source.texts[blk.id]?.[f]) ? "translated" : "written";
      row = { lang: parsed.target, dir: directionOf(parsed.target), subject: "", preheader: "", texts: {}, review, status: "draft", translated_by: "person" };
    } else {
      const r = await aiTranslate(
        { tenantId: ctx.tenantId, userId: ctx.userId, config: ctx.config },
        { source: { subject: source.subject, preheader: source.preheader, blocks: b.newsletter.blocks, texts: source.texts }, target: parsed.target, tone: ctx.kit.tone, companyName: ctx.tenantName },
      );
      row = r.row;
      kept = r.kept;
    }
    row.status = languageStatus(row, b.newsletter.blocks);
    if (!(await upsertLanguage(ctx, id, row))) return pendingResponse();
    return NextResponse.json({ language: row, kept }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

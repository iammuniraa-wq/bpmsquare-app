import { NextResponse, type NextRequest } from "next/server";
import { runChecks } from "@/lib/newsletter/checks";
import { renderNewsletter } from "@/lib/newsletter/render";
import { pendingBlocks, sanitizeLanguageRow, sanitizeNewsletterBlocks } from "@/lib/newsletter/sanitize";
import { SOURCE_LANGUAGE, isKnownLanguage, type LanguageRow } from "@/lib/newsletter/types";
import { assetBaseUrl, errorResponse, newsletterAccess, verifyProducts } from "@/lib/newsletter/server";

// POST /api/newsletters/preview { blocks, languages, lang } -> { html, text, links, checks, languages }
// Renders what is in the studio right now WITHOUT saving: the same gate and the same
// renderer a save and a send use, so the preview shows what would be sent. The studio
// puts `html` in a sandboxed iframe (srcDoc, no scripts).

export async function POST(req: NextRequest) {
  try {
    const ctx = await newsletterAccess("view");
    const body = (await req.json().catch(() => null)) as { blocks?: unknown; languages?: unknown; lang?: unknown; target?: unknown } | null;
    if (!body || !Array.isArray(body.blocks) || !Array.isArray(body.languages)) return NextResponse.json({ error: "Invalid body." }, { status: 422 });

    const gate = sanitizeNewsletterBlocks(body.blocks, ctx.tenantId);
    const { blocks } = await verifyProducts(ctx, gate.blocks);
    const rows: LanguageRow[] = [];
    for (const raw of body.languages) {
      const row = sanitizeLanguageRow(raw, blocks);
      if (row && !rows.some((r) => r.lang === row.lang)) rows.push(row);
    }
    const active = rows.find((r) => r.lang === (isKnownLanguage(body.lang) ? body.lang : SOURCE_LANGUAGE)) ?? rows[0];
    if (!active) return NextResponse.json({ error: "No language to show." }, { status: 422 });

    const out = renderNewsletter({
      blocks, language: active, kit: ctx.kit, tenantId: ctx.tenantId, assetBase: assetBaseUrl(),
      // "version" keeps the merge tokens in place (the email HTML fold and Export); the default fills sample values.
      target: body.target === "version" ? "version" : "preview",
      openPixel: body.target === "version" && ctx.config.marketing?.track_opens === true,
      sample: { company_name: ctx.tenantName },
    });
    return NextResponse.json({
      html: out.html, text: out.text, links: out.links,
      checks: runChecks({ blocks, languages: rows, kit: ctx.kit, tenantId: ctx.tenantId }),
      languages: rows.map((r) => ({ lang: r.lang, status: r.status, pending: pendingBlocks(r, blocks) })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

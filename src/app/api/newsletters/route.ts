import { NextResponse, type NextRequest } from "next/server";
import { parseListParams, parseSave } from "@/lib/newsletter/requests";
import { errorResponse, listNewsletters, newsletterAccess, pendingResponse, saveNewsletter } from "@/lib/newsletter/server";

// Newsletter Studio (0141, docs/newsletter-studio-architecture.md).
//
// GET  /api/newsletters?template=1&q=&status=&category=&page=  -> { newsletters, total, page, pages, pending_migration? }
// POST /api/newsletters { name, category?, topic?, blocks, languages, template_origin_id?, built_in_origin? }
//        -> 201 { id, ref, warnings }. Blocks and words pass the sanitisers; nothing is stored as written.

export async function GET(req: NextRequest) {
  try {
    const ctx = await newsletterAccess("view");
    const p = parseListParams(req.nextUrl.searchParams);
    const r = await listNewsletters(ctx, p);
    return NextResponse.json({
      newsletters: r.rows, total: r.total, page: p.page, pages: Math.max(1, Math.ceil(r.total / p.page_size)),
      ...(r.missing ? { pending_migration: true } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await newsletterAccess("create");
    const parsed = parseSave(await req.json().catch(() => null), { creating: true });
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const saved = await saveNewsletter(ctx, null, parsed.value);
    if ("missing" in saved) return pendingResponse();
    return NextResponse.json({ id: saved.id, ref: saved.ref, warnings: saved.warnings }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

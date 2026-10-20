import { NextResponse, type NextRequest } from "next/server";
import { createForm, errorResponse, formsAccess, listForms, parseFormListParams, pendingResponse } from "@/lib/marketing/forms/server";

// Forms (0170, docs/shells/forms-shell.md). Signed-in side only; the public submit is /api/f/[key].
//
// GET  /api/marketing-forms?q=&status=&page=  -> { forms, total, page, pages, pending_migration? }
// POST /api/marketing-forms { name, slug?, title, intro, button_label, fields, consent, after_submit, status }
//        -> 201 { id, ref, slug, warnings }. Every text passes the sanitisers; nothing is stored as written.

export async function GET(req: NextRequest) {
  try {
    const ctx = await formsAccess("view");
    const p = parseFormListParams(req.nextUrl.searchParams);
    const r = await listForms(ctx, p);
    return NextResponse.json({
      forms: r.rows, total: r.total, page: p.page, pages: Math.max(1, Math.ceil(r.total / p.page_size)),
      ...(r.missing ? { pending_migration: true } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await formsAccess("create");
    const saved = await createForm(ctx, await req.json().catch(() => null));
    if ("missing" in saved) return pendingResponse();
    return NextResponse.json({ id: saved.id, ref: saved.ref, slug: saved.slug, warnings: saved.warnings }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

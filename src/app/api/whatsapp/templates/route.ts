import { NextResponse, type NextRequest } from "next/server";
import { moduleAccess, moduleErrorResponse, pendingMessage } from "@/lib/marketing/moduleAccess";
import { WHATSAPP_SPEC, createTemplate, listTemplates, parseListParams } from "@/lib/marketing/whatsapp/server";

// WhatsApp templates (0185, docs/shells/whatsapp-shell.md). Signed-in side only.
//
// GET  /api/whatsapp/templates?q=&status=&page=  -> { templates, total, page, pages, pending_migration? }
// POST /api/whatsapp/templates { name, language, category, body, topic?, provider_template_name? } -> 201 { id, ref }
//        A new template is always a draft: approval is a separate, admin-only step.

const pending = () => NextResponse.json({ error: pendingMessage(WHATSAPP_SPEC), pending_migration: true }, { status: 503 });

export async function GET(req: NextRequest) {
  try {
    const ctx = await moduleAccess(WHATSAPP_SPEC, "view");
    const p = parseListParams(req.nextUrl.searchParams);
    const r = await listTemplates(ctx, p);
    return NextResponse.json({
      templates: r.rows, total: r.total, page: p.page, pages: Math.max(1, Math.ceil(r.total / p.page_size)),
      ...(r.missing ? { pending_migration: true } : {}),
    });
  } catch (e) {
    return moduleErrorResponse(WHATSAPP_SPEC, e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await moduleAccess(WHATSAPP_SPEC, "create");
    const saved = await createTemplate(ctx, await req.json().catch(() => null));
    if ("missing" in saved) return pending();
    return NextResponse.json({ id: saved.id, ref: saved.ref }, { status: 201 });
  } catch (e) {
    return moduleErrorResponse(WHATSAPP_SPEC, e);
  }
}

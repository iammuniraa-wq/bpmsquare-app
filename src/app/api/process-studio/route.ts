import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { parseCreate, parseListParams } from "@/lib/studio/requests";
import { studioAccess, errorResponse, pendingResponse, listStudies, createStudy } from "@/lib/studio/server";

// Process Design Studio (0152, docs/process-design-studio-architecture.md).
//
// GET  /api/process-studio?q=&status=&page=  -> { studies, total, page, pages, pending_migration? }
//        The caller's own studies; on a client workspace its admins also see the rest.
// POST /api/process-studio { name }          -> 201 { id, ref }

export async function GET(req: NextRequest) {
  try {
    const ctx = await studioAccess("view");
    const p = parseListParams(req.nextUrl.searchParams);
    const r = await listStudies(ctx, p);
    return NextResponse.json({
      studies: r.rows, total: r.total, page: p.page, pages: Math.max(1, Math.ceil(r.total / p.page_size)),
      ...(r.missing ? { pending_migration: true } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await studioAccess("create");
    const parsed = parseCreate(await req.json().catch(() => null));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
    const created = await createStudy(ctx, parsed.name);
    if ("missing" in created) return pendingResponse();
    await logChange(ctx.supabase, {
      tenantId: ctx.tenantId, objectType: "process_studies", objectId: created.id, objectLabel: created.ref ?? parsed.name,
      action: "create", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "name", from: null, to: parsed.name }],
    });
    return NextResponse.json({ id: created.id, ref: created.ref }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

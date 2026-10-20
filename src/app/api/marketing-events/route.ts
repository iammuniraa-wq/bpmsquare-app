import { NextResponse, type NextRequest } from "next/server";
import { moduleAccess, moduleErrorResponse, pendingMessage } from "@/lib/marketing/moduleAccess";
import { EVENTS_SPEC, createEvent, listEvents, parseListParams } from "@/lib/marketing/events/server";

// Marketing events (0195, docs/shells/events-shell.md). Signed-in side only; people register through a Form.
//
// GET  /api/marketing-events?q=&status=&page=  -> { events, total, page, pages, pending_migration? }
// POST /api/marketing-events { name, kind, status, date, time, end_time?, venue?, link?, capacity?, description?,
//                              form_id?, follow_up_journey_id?, follow_up_on?, owner_user_id? } -> 201 { id, ref }
//        The date and times are the workspace's wall clock; the form, journey and owner are checked against this workspace.

export async function GET(req: NextRequest) {
  try {
    const ctx = await moduleAccess(EVENTS_SPEC, "view");
    const p = parseListParams(req.nextUrl.searchParams);
    const r = await listEvents(ctx, p);
    return NextResponse.json({ events: r.rows, total: r.total, page: p.page, pages: Math.max(1, Math.ceil(r.total / p.page_size)), ...(r.missing ? { pending_migration: true } : {}) });
  } catch (e) {
    return moduleErrorResponse(EVENTS_SPEC, e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await moduleAccess(EVENTS_SPEC, "create");
    const saved = await createEvent(ctx, await req.json().catch(() => null));
    if ("missing" in saved) return NextResponse.json({ error: pendingMessage(EVENTS_SPEC), pending_migration: true }, { status: 503 });
    return NextResponse.json({ id: saved.id, ref: saved.ref }, { status: 201 });
  } catch (e) {
    return moduleErrorResponse(EVENTS_SPEC, e);
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { inboxAccess, errorResponse } from "@/lib/inbox/server";
import { loadDetail, markRead, patchEmail } from "@/lib/inbox/detail";

// GET   /api/inbox/emails/[id]  the message, its conversation, files (with quality labels), who it could be assigned to
// PATCH /api/inbox/emails/[id]  { status?: new|handled|spam, assigned_to?: user id | null }  (edit access)
// A message of a channel the person is not on the team of answers 404, the same as one that does not exist.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await inboxAccess(false);
    const { id } = await params;
    const d = await loadDetail(ctx, id);
    if (!d) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    await markRead(ctx, d.email);
    return NextResponse.json(d);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await inboxAccess(true);
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { status?: unknown; assigned_to?: unknown } | null;
    if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = await patchEmail(ctx, id, { status: body.status, assigned_to: body.assigned_to });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, status: r.email.status, assigned_to: r.email.assigned_to });
  } catch (e) {
    return errorResponse(e);
  }
}

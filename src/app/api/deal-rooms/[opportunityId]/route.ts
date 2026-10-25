import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { ensureRoom, loadRoom, openRoomRequest, roomPayload } from "@/lib/tender/roomServer";

// GET  /api/deal-rooms/[opportunityId]  -> the room's header: members (last seen), who could be added, unread and open questions.
//                                          { room: null } when nobody has opened it yet.
// POST /api/deal-rooms/[opportunityId]  -> open the room (idempotent). The deal's owner and team, and the person opening it,
//                                          become its first members.
// INTERNAL ONLY. Behind gcc_tender + deal_room + pipeline, the caller's view of the Pipeline workcenter, and a tender deal of
// THIS workspace; anything else is the same 404 (openRoomRequest). The workspace comes from the session, never from the request.

const PENDING = { error: "The Deal Room needs a database update (migration 0222). Ask your administrator to apply it" };

export async function GET(_req: NextRequest, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  const opened = await openRoomRequest(opportunityId);
  if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status });
  const { room, pending } = await loadRoom(opened.req.admin, opened.req.tenantId, opportunityId);
  if (pending) return NextResponse.json(PENDING, { status: 503 });
  return NextResponse.json(await roomPayload(opened.req, room));
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  const opened = await openRoomRequest(opportunityId);
  if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status });
  const r = opened.req;
  const before = await loadRoom(r.admin, r.tenantId, opportunityId);
  if (before.pending) return NextResponse.json(PENDING, { status: 503 });
  const { room, pending } = await ensureRoom(r);
  if (pending) return NextResponse.json(PENDING, { status: 503 });
  if (!room) return NextResponse.json({ error: "Could not open the room" }, { status: 500 });
  if (!before.room) {
    const user = await getAuthUser();
    await logChange(r.supabase, {
      tenantId: r.tenantId, objectType: "deal_rooms", objectId: room.id, objectLabel: `${r.opp.ref ?? ""} ${r.opp.title}`.trim(),
      action: "create", actorId: user?.id, actorEmail: user?.email,
    });
  }
  return NextResponse.json(await roomPayload(r, room), { status: before.room ? 200 : 201 });
}

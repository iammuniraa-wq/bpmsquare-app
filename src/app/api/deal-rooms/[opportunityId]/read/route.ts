import { NextResponse, type NextRequest } from "next/server";
import { loadRoom, markRead, openRoomRequest } from "@/lib/tender/roomServer";

// POST /api/deal-rooms/[opportunityId]/read  -- "I have read the room up to now". Moves the caller's own read marker (and last
// seen) and nothing else; a person who is not a member has no marker, so nothing changes for them.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  const opened = await openRoomRequest(opportunityId);
  if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status });
  const r = opened.req;
  const { room, pending } = await loadRoom(r.admin, r.tenantId, opportunityId);
  if (pending) return NextResponse.json({ error: "The Deal Room needs a database update (migration 0222)" }, { status: 503 });
  if (room) await markRead(r.admin, r.tenantId, room.id, r.userId);
  return NextResponse.json({ ok: true });
}

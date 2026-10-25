import { NextResponse, type NextRequest } from "next/server";
import { loadRoom, openRoomRequest, roomFileLink } from "@/lib/tender/roomServer";

// GET /api/deal-rooms/[opportunityId]/files/[fileId]  -> 303 to a 60-second signed link. The bytes are never public. The file
// must belong to THIS room of THIS workspace and to a message that has not been removed; otherwise 404.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ opportunityId: string; fileId: string }> }) {
  const { opportunityId, fileId } = await params;
  const opened = await openRoomRequest(opportunityId);
  if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status });
  const r = opened.req;
  const { room } = await loadRoom(r.admin, r.tenantId, opportunityId);
  const url = room ? await roomFileLink(r.admin, r.tenantId, room.id, fileId) : null;
  if (!url) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.redirect(url, 303);
}

import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { addMembers, ensureRoom, loadRoom, openRoomRequest, peopleByIds, personName, roomPayload } from "@/lib/tender/roomServer";

// POST   /api/deal-rooms/[opportunityId]/members  { user_id }   add a colleague by name (a member of THIS workspace only).
// DELETE /api/deal-rooms/[opportunityId]/members?user_id=       leave the room, or (admin / the deal's owner) remove someone.
// Members follow the room: unread counts and the e-mail digest. They do not decide who can read it; anyone who can open the
// deal and reach the Pipeline can.

const PENDING = { error: "The Deal Room needs a database update (migration 0222). Ask your administrator to apply it" };

export async function POST(request: NextRequest, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  const opened = await openRoomRequest(opportunityId);
  if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status });
  const r = opened.req;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const target = typeof body.user_id === "string" ? body.user_id : "";
  if (!target) return NextResponse.json({ error: "user_id is required" }, { status: 400 });

  const { room, pending } = await ensureRoom(r);
  if (pending) return NextResponse.json(PENDING, { status: 503 });
  if (!room) return NextResponse.json({ error: "Could not open the room" }, { status: 500 });
  const added = await addMembers(r.admin, r.tenantId, room.id, [target], r.userId);
  if (added.length === 0) {
    const [person] = await peopleByIds(r.admin, r.tenantId, [target]);
    if (!person) return NextResponse.json({ error: "That person is not a member of this workspace" }, { status: 422 });
  } else {
    const [person] = await peopleByIds(r.admin, r.tenantId, added);
    const user = await getAuthUser();
    await logChange(r.supabase, {
      tenantId: r.tenantId, objectType: "deal_rooms", objectId: room.id, objectLabel: `${r.opp.ref ?? ""} ${r.opp.title}`.trim(), action: "update",
      actorId: user?.id, actorEmail: user?.email, changes: [{ field: "Member added", from: null, to: person ? personName(person) : added[0] }],
    });
  }
  return NextResponse.json(await roomPayload(r, room), { status: added.length ? 201 : 200 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  const opened = await openRoomRequest(opportunityId);
  if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status });
  const r = opened.req;
  const target = new URL(request.url).searchParams.get("user_id") || r.userId;
  const { room, pending } = await loadRoom(r.admin, r.tenantId, opportunityId);
  if (pending) return NextResponse.json(PENDING, { status: 503 });
  if (!room) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target !== r.userId && r.role !== "admin" && r.opp.owner_id !== r.userId) {
    return NextResponse.json({ error: "Only an admin or the deal's owner can remove someone else" }, { status: 403 });
  }
  const { data, error } = await r.admin.from("deal_room_members").delete().eq("tenant_id", r.tenantId).eq("room_id", room.id).eq("user_id", target).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if ((data ?? []).length > 0) {
    const [person] = await peopleByIds(r.admin, r.tenantId, [target]);
    const user = await getAuthUser();
    await logChange(r.supabase, {
      tenantId: r.tenantId, objectType: "deal_rooms", objectId: room.id, objectLabel: `${r.opp.ref ?? ""} ${r.opp.title}`.trim(), action: "update",
      actorId: user?.id, actorEmail: user?.email, changes: [{ field: "Member removed", from: person ? personName(person) : target, to: null }],
    });
  }
  return NextResponse.json(await roomPayload(r, room));
}

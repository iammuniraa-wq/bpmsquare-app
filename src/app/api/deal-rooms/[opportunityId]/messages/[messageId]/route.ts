import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";
import { loadRoom, MESSAGE_COLUMNS, openRoomRequest, viewMessages } from "@/lib/tender/roomServer";
import type { RoomMessageRow } from "@/lib/tender/room";

// PATCH /api/deal-rooms/[opportunityId]/messages/[messageId]  { action: "answer" | "reopen" | "remove" }
//   answer / reopen : a question's status. Its owner, its author or a workspace admin.
//   remove          : a SOFT delete. The author or a workspace admin. The row stays (append-only), the text is never sent to a
//                     screen again, the message reads "removed", and the removal is logged. There is no edit.
// The message is looked up by id AND room AND workspace, so an id from another room or workspace is a 404.

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ opportunityId: string; messageId: string }> }) {
  const { opportunityId, messageId } = await params;
  const opened = await openRoomRequest(opportunityId);
  if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status });
  const r = opened.req;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action;
  if (action !== "answer" && action !== "reopen" && action !== "remove") return NextResponse.json({ error: "action must be answer, reopen or remove" }, { status: 400 });

  const { room, pending } = await loadRoom(r.admin, r.tenantId, opportunityId);
  if (pending) return NextResponse.json({ error: "The Deal Room needs a database update (migration 0222)" }, { status: 503 });
  if (!room || !/^[0-9a-f-]{36}$/i.test(messageId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data } = await r.admin.from("deal_room_messages").select(MESSAGE_COLUMNS).eq("id", messageId).eq("room_id", room.id).eq("tenant_id", r.tenantId).maybeSingle();
  const msg = data as RoomMessageRow | null;
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (msg.deleted_at) return NextResponse.json({ error: "This message was removed" }, { status: 409 });

  const isAdmin = r.role === "admin";
  const now = new Date().toISOString();
  const label = `${r.opp.ref ?? ""} ${r.opp.title}`.trim();
  const user = await getAuthUser();
  let patch: Record<string, unknown>;

  if (action === "remove") {
    if (msg.author_id !== r.userId && !isAdmin) return NextResponse.json({ error: "Only the author or an admin can remove a message" }, { status: 403 });
    patch = { deleted_at: now, deleted_by: r.userId, updated_at: now };
  } else {
    if (msg.kind !== "question" || !msg.question_status) return NextResponse.json({ error: "Only a question can be answered" }, { status: 400 });
    if (msg.author_id !== r.userId && msg.question_owner_id !== r.userId && !isAdmin) return NextResponse.json({ error: "Only the question's owner, its author or an admin can change it" }, { status: 403 });
    const to = action === "answer" ? "answered" : "open";
    if (msg.question_status === to) return NextResponse.json({ message: (await viewMessages(r.admin, r.tenantId, room.id, [msg]))[0] });
    patch = action === "answer"
      ? { question_status: "answered", answered_at: now, answered_by: r.userId, updated_at: now }
      : { question_status: "open", answered_at: null, answered_by: null, updated_at: now };
  }

  const { data: updated, error } = await r.admin.from("deal_room_messages").update(patch)
    .eq("id", messageId).eq("room_id", room.id).eq("tenant_id", r.tenantId).is("deleted_at", null).select(MESSAGE_COLUMNS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = ((updated ?? []) as RoomMessageRow[])[0];
  if (!row) return NextResponse.json({ error: "This message was removed" }, { status: 409 });

  await logChange(r.supabase, {
    tenantId: r.tenantId, objectType: "deal_rooms", objectId: room.id, objectLabel: label, action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: action === "remove" ? "Message removed" : action === "answer" ? "Question answered" : "Question reopened", from: null, to: msg.kind === "decision" ? "decision" : msg.kind }],
  });
  return NextResponse.json({ message: (await viewMessages(r.admin, r.tenantId, room.id, [row]))[0] });
}

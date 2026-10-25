import { NextResponse, type NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { ROOM, filesProblem, parseMessage, pollSince } from "@/lib/tender/room";
import { ensureRoom, listMessages, loadMembers, loadRoom, notifyMentions, openRoomRequest, postMessage, touchSeen, viewMessages } from "@/lib/tender/roomServer";

// GET  /api/deal-rooms/[opportunityId]/messages?since=<iso>|before=<iso>   the latest page, an older page, or what changed since
//                                                                          the last poll (new, answered, removed), plus server time.
// POST /api/deal-rooms/[opportunityId]/messages   JSON { body, kind?, parent_id?, owner_id?, due? } or multipart with the same
//                                                 fields and up to 5 files. Author, room, channel, mentions and time are the
//                                                 server's: the body is read for the fields listed in parseMessage and nothing else.

const PENDING = { error: "The Deal Room needs a database update (migration 0222). Ask your administrator to apply it" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  const opened = await openRoomRequest(opportunityId);
  if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status });
  const r = opened.req;
  const { room, pending } = await loadRoom(r.admin, r.tenantId, opportunityId);
  if (pending) return NextResponse.json(PENDING, { status: 503 });
  const now = new Date();
  if (!room) return NextResponse.json({ messages: [], more: false, server_now: now.toISOString() });

  const url = new URL(request.url);
  const since = pollSince(url.searchParams.get("since"));
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw).toISOString() : null;
  const { rows, more } = await listMessages(r.admin, r.tenantId, room.id, { since, before });
  const messages = await viewMessages(r.admin, r.tenantId, room.id, rows);

  // A poll proves the person is here; written at most once a minute.
  const me = (await loadMembers(r.admin, r.tenantId, room.id)).find((m) => m.user_id === r.userId);
  await touchSeen(r.admin, r.tenantId, room.id, me, now);
  return NextResponse.json({ messages, more, server_now: now.toISOString() });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ opportunityId: string }> }) {
  const { opportunityId } = await params;
  const opened = await openRoomRequest(opportunityId);
  if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status });
  const r = opened.req;

  let fields: Record<string, unknown> = {};
  let files: File[] = [];
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = k === "is_question" ? v === "true" : v;
    files = form.getAll("files").filter((v): v is File => typeof v !== "string" && v.size > 0);
  } else {
    fields = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  }
  const parsed = parseMessage(fields);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.kind === "decision" && files.length > 0) return NextResponse.json({ error: "A decision is one line, without files" }, { status: 400 });
  const problem = filesProblem(files.map((f) => ({ name: f.name, size: f.size })));
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const { room, pending } = await ensureRoom(r);
  if (pending) return NextResponse.json(PENDING, { status: 503 });
  if (!room) return NextResponse.json({ error: "Could not open the room" }, { status: 500 });

  const posted = await postMessage(r, room, parsed, files);
  if (!posted.ok) return NextResponse.json({ error: posted.error }, { status: posted.status });
  const user = await getAuthUser();
  await notifyMentions(r, { kind: parsed.kind, text: parsed.text, mentioned: posted.mentioned, ownerId: posted.message.question?.owner_id ?? null }, user?.email ?? null);
  return NextResponse.json({ message: posted.message, server_now: new Date().toISOString(), limits: { files: ROOM.maxFiles } }, { status: 201 });
}

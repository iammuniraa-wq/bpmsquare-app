import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { loadActorNames } from "@/lib/actorNames";
import { safeFileName, sniffAttachment } from "@/lib/inbox/rules";
import { inboxNote, memberEmails } from "./notify";
import { isMissingSchema, loadTender, type TenderRow } from "./server";
import {
  ROOM, ROOM_CHANNEL, countUnread, mentionedUserIds, snippet, toMessageView, unreadFloor,
  type ParsedMessage, type RoomFileView, type RoomMessageRow, type RoomMessageView, type RoomPayload, type RoomPerson,
} from "./room";

import { readAllPages } from "@/lib/pagedRead";
// Server side of the Deal Room (migration 0222). INTERNAL ONLY. Every query is tenant-scoped on the admin client and every
// one tolerates the migration being pending: a missing table answers `pending`, never a crash. A room is reached ONLY through
// openRoomRequest(): the three flags (gcc_tender, deal_room, pipeline), the caller's view of the Pipeline workcenter, and a
// deal of THIS workspace that has a tender row. Any miss is the same 404, so nobody can tell a room exists.

export const ROOM_BUCKET = "deal-room-files";

export type RoomRequest = {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  opp: NonNullable<Awaited<ReturnType<typeof loadOpportunity>>>;
  tender: TenderRow;
};

export type RoomFailure = { status: number; error: string };

/** The one gate for every room route. */
export async function openRoomRequest(opportunityId: string): Promise<{ ok: true; req: RoomRequest } | ({ ok: false } & RoomFailure)> {
  let ctx;
  try {
    ctx = await requireTenantUser();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return { ok: false, status: err.status ?? 401, error: err.message ?? "Unauthorized" };
  }
  const { supabase, tenantId, userId, role } = ctx;
  const notFound = { ok: false as const, status: 404, error: "Not found" };
  for (const key of ["gcc_tender", "deal_room", "pipeline"] as const) {
    if (!(await tenantHasFeature(supabase, tenantId, key))) return notFound;
  }
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "pipeline")) return notFound;
  if (!/^[0-9a-f-]{36}$/i.test(opportunityId)) return notFound;
  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, opportunityId);
  const tender = opp ? await loadTender(admin, tenantId, opportunityId) : null;
  if (!opp || !tender) return notFound;
  return { ok: true, req: { admin, supabase, tenantId, userId, role, opp, tender } };
}

export type RoomRow = { id: string; tenant_id: string; opportunity_id: string; created_by: string | null; created_at: string };
export type MemberRow = { id: string; room_id: string; user_id: string; added_by: string | null; added_at: string; last_seen_at: string | null; last_read_at: string | null; last_digest_at: string | null };

const ROOM_COLUMNS = "id, tenant_id, opportunity_id, created_by, created_at";
const MEMBER_COLUMNS = "id, room_id, user_id, added_by, added_at, last_seen_at, last_read_at, last_digest_at";
export const MESSAGE_COLUMNS = "id, kind, body, parent_id, author_id, mentions, question_owner_id, question_due, question_status, answered_at, deleted_at, created_at, updated_at";

export async function loadRoom(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<{ room: RoomRow | null; pending: boolean }> {
  const { data, error } = await admin.from("deal_rooms").select(ROOM_COLUMNS).eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).maybeSingle();
  if (error) return { room: null, pending: isMissingSchema(error) };
  return { room: (data as RoomRow | null) ?? null, pending: false };
}

export async function loadMembers(admin: SupabaseClient, tenantId: string, roomId: string): Promise<MemberRow[]> {
  const { data } = await admin.from("deal_room_members").select(MEMBER_COLUMNS).eq("tenant_id", tenantId).eq("room_id", roomId).limit(500);
  return (data ?? []) as MemberRow[];
}

/** Of these ids, the ones that are members of THIS workspace (a foreign id never gets in). */
export async function tenantMemberIds(admin: SupabaseClient, tenantId: string, ids: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(ids.filter((x) => typeof x === "string" && x))];
  if (wanted.length === 0) return [];
  const { data } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).in("user_id", wanted);
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

/** Add people to a room (members of this workspace only, each once). Returns the ids actually added. */
export async function addMembers(admin: SupabaseClient, tenantId: string, roomId: string, userIds: readonly string[], addedBy: string | null): Promise<string[]> {
  const eligible = await tenantMemberIds(admin, tenantId, userIds);
  if (eligible.length === 0) return [];
  const have = new Set((await loadMembers(admin, tenantId, roomId)).map((m) => m.user_id));
  const fresh = eligible.filter((id) => !have.has(id));
  if (fresh.length === 0) return [];
  const now = new Date().toISOString();
  const { error } = await admin.from("deal_room_members").insert(fresh.map((user_id) => ({ tenant_id: tenantId, room_id: roomId, user_id, added_by: addedBy, added_at: now })));
  if (error && error.code !== "23505") return [];
  return fresh;
}

/** The room of a deal, made on first use: the owner, the team and the person opening it are its first members. */
export async function ensureRoom(r: RoomRequest): Promise<{ room: RoomRow | null; pending: boolean }> {
  const found = await loadRoom(r.admin, r.tenantId, r.opp.id);
  if (found.pending || found.room) return found;
  const { data, error } = await r.admin.from("deal_rooms").insert({ tenant_id: r.tenantId, opportunity_id: r.opp.id, created_by: r.userId }).select(ROOM_COLUMNS).single();
  let room = (data as RoomRow | null) ?? null;
  if (error) {
    if (isMissingSchema(error)) return { room: null, pending: true };
    // Two people opened it at once: the other insert won, use theirs.
    if (error.code === "23505") room = (await loadRoom(r.admin, r.tenantId, r.opp.id)).room;
    if (!room) return { room: null, pending: false };
  } else if (room) {
    const team = (r.opp.team ?? []).map((t: { user_id: string }) => t.user_id);
    await addMembers(r.admin, r.tenantId, room.id, [r.opp.owner_id ?? "", ...team, r.userId].filter(Boolean), r.userId);
  }
  return { room, pending: false };
}

// ── People ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Name and e-mail of each id that is a member of this workspace. */
export async function peopleByIds(admin: SupabaseClient, tenantId: string, ids: readonly string[]): Promise<RoomPerson[]> {
  const ok = await tenantMemberIds(admin, tenantId, ids);
  if (ok.length === 0) return [];
  const labelled = await loadActorNames(admin, tenantId, ok);
  return Promise.all(ok.map(async (id) => {
    const { data } = await admin.auth.admin.getUserById(id);
    const email = data?.user?.email ?? null;
    const full = (data?.user?.user_metadata?.full_name as string | undefined)?.trim() || null;
    return { user_id: id, name: labelled.get(id) ?? full, email };
  }));
}

export const personName = (p: RoomPerson) => p.name?.trim() || p.email?.split("@")[0] || "Colleague";
export const nameMapOf = (people: readonly RoomPerson[]) => new Map(people.map((p) => [p.user_id, personName(p)]));

// ── Messages ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Messages as the screen draws them: names resolved, files attached, removed text withheld. */
export async function viewMessages(admin: SupabaseClient, tenantId: string, roomId: string, rows: RoomMessageRow[]): Promise<RoomMessageView[]> {
  if (rows.length === 0) return [];
  const people = await peopleByIds(admin, tenantId, [...rows.map((r) => r.author_id), ...rows.map((r) => r.question_owner_id ?? "")]);
  const names = nameMapOf(people);
  const live = rows.filter((r) => !r.deleted_at).map((r) => r.id);
  const files = new Map<string, RoomFileView[]>();
  if (live.length > 0) {
    const { data } = await admin.from("deal_room_files").select("id, message_id, file_name, size_bytes, mime_type").eq("tenant_id", tenantId).eq("room_id", roomId).in("message_id", live);
    for (const f of (data ?? []) as { id: string; message_id: string; file_name: string; size_bytes: number; mime_type: string | null }[]) {
      files.set(f.message_id, [...(files.get(f.message_id) ?? []), { id: f.id, name: f.file_name, size: Number(f.size_bytes), mime: f.mime_type }]);
    }
  }
  return rows.map((r) => toMessageView(r, names, files.get(r.id) ?? []));
}

/**
 * The messages a poll or a first load asks for. `since` = everything created or changed after it (an answered question, a
 * removed message); `before` = an older page; neither = the latest page. Always scoped to the room AND the workspace.
 */
export async function listMessages(admin: SupabaseClient, tenantId: string, roomId: string, q: { since?: string | null; before?: string | null; limit?: number }): Promise<{ rows: RoomMessageRow[]; more: boolean }> {
  const limit = Math.min(Math.max(q.limit ?? ROOM.pageSize, 1), ROOM.pageSize);
  let query = admin.from("deal_room_messages").select(MESSAGE_COLUMNS).eq("tenant_id", tenantId).eq("room_id", roomId);
  if (q.since) {
    const { data } = await query.gt("updated_at", q.since).order("created_at", { ascending: true }).limit(500);
    return { rows: (data ?? []) as RoomMessageRow[], more: false };
  }
  if (q.before) query = query.lt("created_at", q.before);
  const { data } = await query.order("created_at", { ascending: false }).limit(limit + 1);
  const rows = (data ?? []) as RoomMessageRow[];
  return { rows: rows.slice(0, limit).reverse(), more: rows.length > limit };
}

type Stored = { file_name: string; storage_path: string; mime_type: string; size_bytes: number };

/** Put one uploaded file in the private bucket if its BYTES say it is an allowed type (the Inbox allow-list: no SVG, no HTML). */
async function storeFile(admin: SupabaseClient, tenantId: string, roomId: string, file: File): Promise<{ ok: true; stored: Stored } | { ok: false; error: string }> {
  const buf = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffAttachment(buf, file.name);
  if (!sniffed.ok) return { ok: false, error: `${file.name || "A file"} is not an allowed type (PDF, Office, DXF, CSV, text or a picture)` };
  const path = `${tenantId}/${roomId}/${randomUUID()}.${sniffed.ext}`;
  const { error } = await admin.storage.from(ROOM_BUCKET).upload(path, buf, { contentType: sniffed.mime, upsert: false });
  if (error) return { ok: false, error: "The file could not be stored" };
  return { ok: true, stored: { file_name: safeFileName(file.name, sniffed.ext), storage_path: path, mime_type: sniffed.mime, size_bytes: buf.length } };
}

export type PostResult = { ok: true; message: RoomMessageView; mentioned: string[] } | ({ ok: false } & RoomFailure);

/** Post a message (and its files) as the caller. Everything about who and when is the server's. */
export async function postMessage(r: RoomRequest, room: RoomRow, parsed: Extract<ParsedMessage, { ok: true }>, files: File[]): Promise<PostResult> {
  const { admin, tenantId, userId } = r;

  // A reply goes under the ROOT of its thread (one level). The parent must be a live message of this room.
  let parentId: string | null = null;
  if (parsed.parentId) {
    const { data: parent } = await admin.from("deal_room_messages").select("id, parent_id, deleted_at")
      .eq("id", parsed.parentId).eq("room_id", room.id).eq("tenant_id", tenantId).maybeSingle();
    const p = parent as { id: string; parent_id: string | null; deleted_at: string | null } | null;
    if (!p || p.deleted_at) return { ok: false, status: 404, error: "The message you are replying to was not found" };
    parentId = p.parent_id ?? p.id;
  }

  let ownerId: string | null = null;
  if (parsed.kind === "question" && parsed.ownerId) {
    const [ok] = await tenantMemberIds(admin, tenantId, [parsed.ownerId]);
    if (!ok) return { ok: false, status: 422, error: "The question's owner must be a member of this workspace" };
    ownerId = ok;
  }

  // Posting makes you a member (you follow what you take part in); mentions are read from the text, members only.
  await addMembers(admin, tenantId, room.id, [userId], userId);
  const members = await loadMembers(admin, tenantId, room.id);
  const people = await peopleByIds(admin, tenantId, members.map((m) => m.user_id));
  const mentions = parsed.kind === "decision" ? [] : mentionedUserIds(parsed.text, people, userId);

  const stored: Stored[] = [];
  for (const f of files) {
    const res = await storeFile(admin, tenantId, room.id, f);
    if (!res.ok) {
      if (stored.length > 0) await admin.storage.from(ROOM_BUCKET).remove(stored.map((s) => s.storage_path));
      return { ok: false, status: 422, error: res.error };
    }
    stored.push(res.stored);
  }

  const now = new Date().toISOString();
  const { data, error } = await admin.from("deal_room_messages").insert({
    tenant_id: tenantId, room_id: room.id, channel: ROOM_CHANNEL, kind: parsed.kind, body: parsed.text, parent_id: parentId, author_id: userId,
    mentions, question_owner_id: ownerId, question_due: parsed.kind === "question" ? parsed.due : null,
    question_status: parsed.kind === "question" ? "open" : null, created_at: now, updated_at: now,
  }).select(MESSAGE_COLUMNS).single();
  if (error || !data) {
    if (stored.length > 0) await admin.storage.from(ROOM_BUCKET).remove(stored.map((s) => s.storage_path));
    return { ok: false, status: isMissingSchema(error) ? 503 : 500, error: isMissingSchema(error) ? "The Deal Room needs a database update (migration 0222)" : error?.message ?? "Could not post" };
  }
  const row = data as RoomMessageRow;
  if (stored.length > 0) {
    const { error: fErr } = await admin.from("deal_room_files").insert(stored.map((s) => ({ ...s, tenant_id: tenantId, room_id: room.id, message_id: row.id, uploaded_by: userId })));
    if (fErr) {
      await admin.storage.from(ROOM_BUCKET).remove(stored.map((s) => s.storage_path));
      await admin.from("deal_room_messages").delete().eq("id", row.id).eq("tenant_id", tenantId);
      return { ok: false, status: 500, error: "The files could not be saved" };
    }
  }
  // Writing something counts as having read everything up to it.
  await admin.from("deal_room_members").update({ last_read_at: now, last_seen_at: now }).eq("tenant_id", tenantId).eq("room_id", room.id).eq("user_id", userId);

  const [view] = await viewMessages(admin, tenantId, room.id, [row]);
  return { ok: true, message: view, mentioned: [...new Set([...mentions, ...(ownerId && ownerId !== userId ? [ownerId] : [])])] };
}

/** Tell people they were mentioned or asked: a Nova inbox entry (a mentioning comment on the deal). Best effort, never throws. */
export async function notifyMentions(r: RoomRequest, post: { kind: string; text: string; mentioned: string[]; ownerId: string | null }, authorEmail: string | null): Promise<void> {
  try {
    const everyone = post.mentioned.filter((id) => id !== r.userId);
    if (everyone.length === 0) return;
    const emails = await memberEmails(r.admin, r.tenantId, everyone);
    const asked = emails.filter((e) => e.user_id === post.ownerId);
    const named = emails.filter((e) => e.user_id !== post.ownerId);
    const body = (lead: string) => `${lead}: ${snippet(post.text, 300)}`;
    if (named.length > 0) await inboxNote(r.admin, { tenantId: r.tenantId, dealId: r.opp.id, authorId: r.userId, authorEmail, body: body("Mentioned you in the Deal Room"), mentionEmails: named.map((e) => e.email) });
    if (asked.length > 0) await inboxNote(r.admin, { tenantId: r.tenantId, dealId: r.opp.id, authorId: r.userId, authorEmail, body: body("Asked you a question in the Deal Room"), mentionEmails: asked.map((e) => e.email) });
  } catch (e) {
    console.error("[deal room] mention notification failed", (e as Error).message);
  }
}

// ── Unread and open questions ──────────────────────────────────────────────────────────────────────────────────────

/** Unread count per DEAL for one member, across the rooms they follow. Empty while the migration is pending. */
export async function unreadByDeal(admin: SupabaseClient, tenantId: string, userId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const { data: mine, error } = await readAllPages((lo, hi) => admin.from("deal_room_members").select("room_id, added_at, last_read_at").eq("tenant_id", tenantId).eq("user_id", userId).order("id", { ascending: true }).range(lo, hi));
  if (error || !mine || mine.length === 0) return out;
  const members = mine as { room_id: string; added_at: string; last_read_at: string | null }[];
  const roomIds = members.map((m) => m.room_id);
  const [{ data: rooms }, { data: msgs }] = await Promise.all([
    admin.from("deal_rooms").select("id, opportunity_id").eq("tenant_id", tenantId).in("id", roomIds),
    readAllPages((lo, hi) => admin.from("deal_room_messages").select("room_id, author_id, created_at, deleted_at").eq("tenant_id", tenantId).in("room_id", roomIds)
      .gt("created_at", new Date(Math.min(...members.map((m) => Date.parse(unreadFloor(m))))).toISOString()).order("id", { ascending: true }).range(lo, hi)),
  ]);
  const dealOf = new Map(((rooms ?? []) as { id: string; opportunity_id: string }[]).map((x) => [x.id, x.opportunity_id]));
  const byRoom = new Map<string, { author_id: string; created_at: string; deleted_at: string | null }[]>();
  for (const m of (msgs ?? []) as { room_id: string; author_id: string; created_at: string; deleted_at: string | null }[]) byRoom.set(m.room_id, [...(byRoom.get(m.room_id) ?? []), m]);
  for (const m of members) {
    const n = countUnread(byRoom.get(m.room_id) ?? [], unreadFloor(m), userId);
    const deal = dealOf.get(m.room_id);
    if (deal && n > 0) out.set(deal, n);
  }
  return out;
}

/** Open (not answered, not removed) questions per room. */
export async function openQuestionCounts(admin: SupabaseClient, tenantId: string, roomIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (roomIds.length === 0) return out;
  const { data } = await readAllPages((lo, hi) => admin.from("deal_room_messages").select("id, room_id").eq("tenant_id", tenantId).in("room_id", roomIds).eq("kind", "question").eq("question_status", "open").is("deleted_at", null).order("id", { ascending: true }).range(lo, hi));
  for (const r of (data ?? []) as { room_id: string }[]) out.set(r.room_id, (out.get(r.room_id) ?? 0) + 1);
  return out;
}

export type RoomSummary = { pending: boolean; exists: boolean; unread: number; openQuestions: number };

/** What the deal page needs for the Room tab's badge and the Overview's open-questions link. */
export async function roomSummary(admin: SupabaseClient, tenantId: string, userId: string, opportunityId: string): Promise<RoomSummary> {
  const { room, pending } = await loadRoom(admin, tenantId, opportunityId);
  if (pending) return { pending: true, exists: false, unread: 0, openQuestions: 0 };
  if (!room) return { pending: false, exists: false, unread: 0, openQuestions: 0 };
  const [unread, open] = await Promise.all([unreadByDeal(admin, tenantId, userId), openQuestionCounts(admin, tenantId, [room.id])]);
  return { pending: false, exists: true, unread: unread.get(opportunityId) ?? 0, openQuestions: open.get(room.id) ?? 0 };
}

/** Mark everything read for a member, and note they were here. A non-member has nothing to mark. */
export async function markRead(admin: SupabaseClient, tenantId: string, roomId: string, userId: string, now = new Date()): Promise<void> {
  const at = now.toISOString();
  await admin.from("deal_room_members").update({ last_read_at: at, last_seen_at: at }).eq("tenant_id", tenantId).eq("room_id", roomId).eq("user_id", userId);
}

/** last_seen_at, at most once a minute per member (a poll every 10 seconds must not be a write every 10 seconds). */
export async function touchSeen(admin: SupabaseClient, tenantId: string, roomId: string, member: MemberRow | undefined, now = new Date()): Promise<void> {
  if (!member) return;
  if (member.last_seen_at && now.getTime() - Date.parse(member.last_seen_at) < ROOM.seenThrottleMs) return;
  await admin.from("deal_room_members").update({ last_seen_at: now.toISOString() }).eq("tenant_id", tenantId).eq("room_id", roomId).eq("user_id", member.user_id);
}

/** A signed, 60-second link to one file of this room (the bytes are never public). Null when it is not this room's. */
export async function roomFileLink(admin: SupabaseClient, tenantId: string, roomId: string, fileId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const { data } = await admin.from("deal_room_files").select("file_name, storage_path, mime_type, message_id")
    .eq("id", fileId).eq("room_id", roomId).eq("tenant_id", tenantId).maybeSingle();
  const f = data as { file_name: string; storage_path: string; mime_type: string | null; message_id: string } | null;
  if (!f || !f.storage_path.startsWith(`${tenantId}/${roomId}/`)) return null;
  // A file of a removed message is gone with it.
  const { data: msg } = await admin.from("deal_room_messages").select("deleted_at").eq("id", f.message_id).eq("tenant_id", tenantId).maybeSingle();
  if (!msg || (msg as { deleted_at: string | null }).deleted_at) return null;
  const inline = f.mime_type === "image/png" || f.mime_type === "image/jpeg";
  const { data: signed, error } = await admin.storage.from(ROOM_BUCKET).createSignedUrl(f.storage_path, 60, inline ? undefined : { download: f.file_name });
  return error || !signed ? null : signed.signedUrl;
}

/** The room's header data: members with when they were last here, who could still be added, and the two counts. */
export async function roomPayload(r: RoomRequest, room: RoomRow | null): Promise<RoomPayload> {
  const now = new Date().toISOString();
  if (!room) return { room: null, members: [], candidates: [], you_are_member: false, unread: 0, open_questions: 0, now };
  const rows = await loadMembers(r.admin, r.tenantId, room.id);
  const { data: all } = await r.admin.from("tenant_users").select("user_id").eq("tenant_id", r.tenantId).limit(300);
  const inRoom = new Set(rows.map((m) => m.user_id));
  const people = await peopleByIds(r.admin, r.tenantId, [...inRoom, ...((all ?? []) as { user_id: string }[]).map((x) => x.user_id)]);
  const byId = new Map(people.map((p) => [p.user_id, p]));
  const [unread, open] = await Promise.all([unreadByDeal(r.admin, r.tenantId, r.userId), openQuestionCounts(r.admin, r.tenantId, [room.id])]);
  return {
    room: { id: room.id, created_at: room.created_at },
    members: rows.map((m) => {
      const p = byId.get(m.user_id);
      return { user_id: m.user_id, name: p ? personName(p) : "Colleague", email: p?.email ?? null, last_seen_at: m.last_seen_at, is_you: m.user_id === r.userId };
    }).sort((a, b) => a.name.localeCompare(b.name)),
    candidates: people.filter((p) => !inRoom.has(p.user_id)).map((p) => ({ user_id: p.user_id, name: personName(p) })).sort((a, b) => a.name.localeCompare(b.name)),
    you_are_member: inRoom.has(r.userId),
    unread: unread.get(r.opp.id) ?? 0,
    open_questions: open.get(room.id) ?? 0,
    now,
  };
}

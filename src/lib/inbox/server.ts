import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter, type PermissionSet } from "@/lib/permissions";
import type { TenantFeatures } from "@/lib/constants";
import { decrypt } from "@/lib/encryption";
import { isSchemaPending } from "@/lib/marketing/pending";
import {
  INBOX_LIMITS, PENDING_MESSAGE, type InboxAttachment, type InboxChannel, type InboxEmail, type InboxStatus, type MailboxConnector,
} from "./types";
import { canSeeChannel, type Viewer } from "./rules";

// The Inbox server core (0214, docs/design/estimator-unification-and-inbox.md). Mail is private correspondence, so:
//   * every table here has RLS on and NO policy: nothing but this code reaches it, on the service-role client;
//   * so EVERY query chains .eq("tenant_id", tenantId) explicitly, the tenant being the one from requireTenantUser()
//     (or, for inbound mail, the one the channel's own signed alias names), never anything in a request or a message;
//   * a message is shown only to people who may see its channel (the team on the channel), checked on every read.
// Mail content is untrusted: it is stored as text, shown escaped, and never used as an instruction or a URL to fetch.

export const ATTACHMENT_BUCKET = "inbox-attachments";
export const isMissingRelation = isSchemaPending;
export { PENDING_MESSAGE };

export type InboxCtx = {
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  email: string | null;
  perms: PermissionSet;
  features: Partial<TenantFeatures>;
  roleIds: string[];
  canEdit: boolean;
  viewer: Viewer;
};

export function errorResponse(e: unknown): Response {
  const err = e as { status?: number; message?: string };
  return Response.json({ error: err.message ?? "Unexpected error" }, { status: err.status ?? 500 });
}

/** The Business Roles a person holds in this workspace (the team a channel is for). */
export async function viewerRoleIds(admin: SupabaseClient, tenantId: string, userId: string): Promise<string[]> {
  const { data, error } = await admin.from("business_user_roles").select("role_id").eq("tenant_id", tenantId).eq("user_id", userId);
  if (error) return [];
  return ((data ?? []) as { role_id: string }[]).map((r) => r.role_id);
}

/**
 * Route guard: signed in, the workspace owns the `inbox` module (404 otherwise, so the endpoint does not advertise
 * itself), and the Inbox workcenter grants view, or edit when `edit`. Throws {status, message}.
 */
export async function inboxAccess(edit: boolean): Promise<InboxCtx> {
  const a = await requireTenantUser();
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features").eq("id", a.tenantId).maybeSingle();
  const features = (data?.features ?? {}) as Partial<TenantFeatures>;
  if (!features.inbox) throw { status: 404, message: "Not found" };
  const perms = await resolvePermissions(a.supabase, a.tenantId, a.userId, a.role);
  if (!(edit ? canEditWorkcenter(perms, "inbox") : canViewWorkcenter(perms, "inbox"))) throw { status: 403, message: "Forbidden" };
  const user = await getAuthUser();
  const roleIds = a.role === "admin" ? [] : await viewerRoleIds(admin, a.tenantId, a.userId);
  return {
    admin, tenantId: a.tenantId, userId: a.userId, role: a.role, email: user?.email ?? null, perms, features, roleIds,
    canEdit: canEditWorkcenter(perms, "inbox"),
    viewer: { isAdmin: a.role === "admin", roleIds },
  };
}

// ── Channels ────────────────────────────────────────────────────────────────────────────────────────────────────────

const CHANNEL_COLUMNS = "id, tenant_id, name, address_alias, connector_id, role_ids, default_action, default_template_id, reply_from, reply_name, active, last_received_at, created_at, updated_at";

export function toChannel(r: Record<string, unknown>): InboxChannel {
  return {
    id: r.id as string, tenant_id: r.tenant_id as string, name: (r.name as string) ?? "Inbox", address_alias: r.address_alias as string,
    connector_id: (r.connector_id as MailboxConnector | null) ?? null,
    role_ids: Array.isArray(r.role_ids) ? (r.role_ids as string[]) : [],
    default_action: (r.default_action as InboxChannel["default_action"]) ?? "none",
    default_template_id: (r.default_template_id as string | null) ?? null,
    reply_from: (r.reply_from as string | null) ?? null, reply_name: (r.reply_name as string | null) ?? null,
    active: r.active !== false,
    created_at: r.created_at as string | undefined, updated_at: r.updated_at as string | undefined,
  };
}

/** Every channel of the workspace. `missing` is true while migration 0214 is not applied. */
export async function loadChannels(admin: SupabaseClient, tenantId: string): Promise<{ channels: (InboxChannel & { last_received_at: string | null })[]; missing: boolean }> {
  const { data, error } = await admin.from("inbox_channels").select(CHANNEL_COLUMNS).eq("tenant_id", tenantId).order("name");
  if (error) {
    if (isMissingRelation(error)) return { channels: [], missing: true };
    throw { status: 500, message: error.message };
  }
  return {
    channels: ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...toChannel(r), last_received_at: (r.last_received_at as string | null) ?? null })),
    missing: false,
  };
}

export async function loadChannel(admin: SupabaseClient, tenantId: string, id: string): Promise<InboxChannel | null> {
  const { data } = await admin.from("inbox_channels").select(CHANNEL_COLUMNS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return data ? toChannel(data as Record<string, unknown>) : null;
}

/** The channels this person may open, and whether the tables exist yet. */
export async function visibleChannelsFor(ctx: Pick<InboxCtx, "admin" | "tenantId" | "viewer">): Promise<{ channels: InboxChannel[]; missing: boolean }> {
  const all = await loadChannels(ctx.admin, ctx.tenantId);
  return { channels: all.channels.filter((c) => canSeeChannel(c, ctx.viewer)), missing: all.missing };
}

/** For callers that only hold a user id (search, briefing): the channel ids this user may open. Never throws. */
export async function visibleChannelIds(admin: SupabaseClient, tenantId: string, userId: string, isAdmin: boolean): Promise<string[]> {
  try {
    const roleIds = isAdmin ? [] : await viewerRoleIds(admin, tenantId, userId);
    const { channels } = await loadChannels(admin, tenantId);
    // A paused channel keeps its old mail readable by its team, so it is not filtered out here.
    return channels.filter((c) => canSeeChannel(c, { isAdmin, roleIds })).map((c) => c.id);
  } catch {
    return [];
  }
}

/** Of these message ids, the ones this person may NOT open (another team's channel, or not this workspace's). Never throws. */
export async function hiddenEmailIds(admin: SupabaseClient, tenantId: string, userId: string, isAdmin: boolean, ids: readonly string[]): Promise<Set<string>> {
  const hidden = new Set(ids);
  try {
    const open = new Set(await visibleChannelIds(admin, tenantId, userId, isAdmin));
    const { data } = await admin.from("inbound_emails").select("id, channel_id").eq("tenant_id", tenantId).in("id", [...ids]);
    for (const r of (data ?? []) as { id: string; channel_id: string }[]) if (open.has(r.channel_id)) hidden.delete(r.id);
  } catch { /* everything stays hidden */ }
  return hidden;
}

/** May this person open this one message (its channel is theirs, or they are an admin)? */
export async function userCanSeeEmail(admin: SupabaseClient, tenantId: string, userId: string, isAdmin: boolean, emailId: string): Promise<boolean> {
  return !(await hiddenEmailIds(admin, tenantId, userId, isAdmin, [emailId])).has(emailId);
}

// ── Messages ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const EMAIL_COLUMNS = "id, tenant_id, channel_id, direction, from_address, from_name, to_addresses, subject, snippet, body_text, message_id, references_ids, thread_key, received_at, status, assigned_to, linked_object_type, linked_object_id, linked_object_label, converted_at, expires_at, purged_at, read_at, handled_at, send_status, error, created_by";
const LIST_COLUMNS = EMAIL_COLUMNS.replace(" body_text,", "");

function safeDecrypt(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  try { return decrypt(v); } catch { return null; }
}

export function toEmail(r: Record<string, unknown>, withBody: boolean): InboxEmail & { references_ids: string | null } {
  return {
    id: r.id as string, tenant_id: r.tenant_id as string, channel_id: r.channel_id as string,
    direction: r.direction === "out" ? "out" : "in",
    from_address: (r.from_address as string | null) ?? null, from_name: (r.from_name as string | null) ?? null,
    to_addresses: Array.isArray(r.to_addresses) ? (r.to_addresses as string[]) : [],
    subject: ((r.subject as string | null) ?? "").slice(0, INBOX_LIMITS.maxSubjectChars),
    snippet: safeDecrypt(r.snippet),
    body_text: withBody ? safeDecrypt(r.body_text) : null,
    message_id: (r.message_id as string | null) ?? null,
    references_ids: (r.references_ids as string | null) ?? null,
    thread_key: (r.thread_key as string | null) ?? null,
    received_at: r.received_at as string,
    status: (r.status as InboxStatus) ?? "new",
    assigned_to: (r.assigned_to as string | null) ?? null,
    linked_object_type: (r.linked_object_type as InboxEmail["linked_object_type"]) ?? null,
    linked_object_id: (r.linked_object_id as string | null) ?? null,
    linked_object_label: (r.linked_object_label as string | null) ?? null,
    converted_at: (r.converted_at as string | null) ?? null,
    expires_at: r.expires_at as string,
    purged_at: (r.purged_at as string | null) ?? null,
    read_at: (r.read_at as string | null) ?? null,
    handled_at: (r.handled_at as string | null) ?? null,
    send_status: (r.send_status as InboxEmail["send_status"]) ?? null,
    error: (r.error as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null,
  };
}

/** One message with its channel, only when this person may see that channel. Null otherwise (a 404, never a 403). */
export async function loadEmailForViewer(ctx: Pick<InboxCtx, "admin" | "tenantId" | "viewer">, id: string): Promise<{ email: ReturnType<typeof toEmail>; channel: InboxChannel } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await ctx.admin.from("inbound_emails").select(EMAIL_COLUMNS).eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (error || !data) return null;
  const channel = await loadChannel(ctx.admin, ctx.tenantId, (data as { channel_id: string }).channel_id);
  if (!channel || !canSeeChannel(channel, ctx.viewer)) return null;
  return { email: toEmail(data as Record<string, unknown>, true), channel };
}

export async function loadThread(ctx: Pick<InboxCtx, "admin" | "tenantId">, email: { id: string; channel_id: string; thread_key: string | null }): Promise<ReturnType<typeof toEmail>[]> {
  if (!email.thread_key) {
    const { data } = await ctx.admin.from("inbound_emails").select(EMAIL_COLUMNS).eq("id", email.id).eq("tenant_id", ctx.tenantId);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => toEmail(r, true));
  }
  const { data } = await ctx.admin.from("inbound_emails").select(EMAIL_COLUMNS)
    .eq("tenant_id", ctx.tenantId).eq("channel_id", email.channel_id).eq("thread_key", email.thread_key)
    .order("received_at", { ascending: true }).limit(200);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toEmail(r, true));
}

export async function loadAttachments(ctx: Pick<InboxCtx, "admin" | "tenantId">, emailIds: readonly string[]): Promise<InboxAttachment[]> {
  if (emailIds.length === 0) return [];
  const { data, error } = await ctx.admin.from("inbound_email_attachments")
    .select("id, email_id, file_name, mime_type, ext, size_bytes, quality, quality_note, summary")
    .eq("tenant_id", ctx.tenantId).in("email_id", [...emailIds]).order("created_at");
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: r.id as string, email_id: r.email_id as string, file_name: r.file_name as string, mime_type: (r.mime_type as string | null) ?? null,
    ext: (r.ext as string | null) ?? null, size_bytes: Number(r.size_bytes ?? 0),
    quality: (r.quality as InboxAttachment["quality"]) ?? "review", quality_note: (r.quality_note as string | null) ?? null, summary: (r.summary as string | null) ?? null,
  }));
}

export type ListParams = { channel?: string | null; status?: InboxStatus | "all"; q?: string | null; page?: number; pageSize?: number; mine?: string | null };

export type ListedEmail = ReturnType<typeof toEmail> & {
  channel_name: string;
  attachments: { count: number; worst: "good" | "review" | "poor" | null };
  replies: number;
};

const escapeLike = (s: string) => s.replace(/[%_\\,()"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

/**
 * The page of customer messages this person may see: only the channels they may open, optionally one channel, a status
 * or a search term (sender or subject; the body is encrypted and is not searchable). Newest first.
 */
export async function listEmails(ctx: Pick<InboxCtx, "admin" | "tenantId" | "viewer">, params: ListParams): Promise<{
  emails: ListedEmail[]; total: number; page: number; pages: number;
  counts: Record<InboxStatus, number>; channels: InboxChannel[]; missing: boolean;
}> {
  const { channels, missing } = await visibleChannelsFor(ctx);
  const empty = { emails: [], total: 0, page: 1, pages: 1, counts: { new: 0, handled: 0, spam: 0 } as Record<InboxStatus, number>, channels, missing };
  if (missing || channels.length === 0) return empty;

  const allowed = channels.map((c) => c.id);
  const ids = params.channel && allowed.includes(params.channel) ? [params.channel] : allowed;
  const pageSize = Math.min(Math.max(1, params.pageSize ?? INBOX_LIMITS.pageSize), INBOX_LIMITS.maxPageSize);
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const term = params.q ? escapeLike(params.q) : "";

  const base = () => {
    let q = ctx.admin.from("inbound_emails").select(LIST_COLUMNS, { count: "exact" })
      .eq("tenant_id", ctx.tenantId).eq("direction", "in").in("channel_id", ids);
    if (term) q = q.or(`subject.ilike.%${term}%,from_address.ilike.%${term}%,from_name.ilike.%${term}%`);
    if (params.mine) q = q.eq("assigned_to", params.mine);
    return q;
  };

  const statusFilter = params.status && params.status !== "all" ? params.status : null;
  let main = base();
  if (statusFilter) main = main.eq("status", statusFilter);
  const { data, count, error } = await main.order("received_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) {
    if (isMissingRelation(error)) return { ...empty, missing: true };
    throw { status: 500, message: error.message };
  }

  const counts = { ...empty.counts };
  await Promise.all((["new", "handled", "spam"] as const).map(async (s) => {
    const r = await base().eq("status", s).limit(1);
    counts[s] = r.count ?? 0;
  }));

  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => toEmail(r, false));
  const atts = await loadAttachments(ctx, rows.map((r) => r.id));
  const rank = { good: 0, review: 1, poor: 2 } as const;
  const byEmail = new Map<string, ListedEmail["attachments"]>();
  for (const a of atts) {
    const cur = byEmail.get(a.email_id) ?? { count: 0, worst: null };
    cur.count += 1;
    // "worst" is the BEST file's label: one good drawing makes the mail workable, so the chip shows that.
    cur.worst = cur.worst === null || rank[a.quality] < rank[cur.worst] ? a.quality : cur.worst;
    byEmail.set(a.email_id, cur);
  }

  const threadKeys = [...new Set(rows.map((r) => r.thread_key).filter((k): k is string => !!k))];
  const replies = new Map<string, number>();
  if (threadKeys.length) {
    const { data: outs } = await ctx.admin.from("inbound_emails").select("thread_key")
      .eq("tenant_id", ctx.tenantId).eq("direction", "out").in("thread_key", threadKeys).in("channel_id", ids);
    for (const o of (outs ?? []) as { thread_key: string }[]) replies.set(o.thread_key, (replies.get(o.thread_key) ?? 0) + 1);
  }

  const nameOf = new Map(channels.map((c) => [c.id, c.name]));
  const total = count ?? rows.length;
  return {
    emails: rows.map((r) => ({
      ...r, channel_name: nameOf.get(r.channel_id) ?? "",
      attachments: byEmail.get(r.id) ?? { count: 0, worst: null },
      replies: r.thread_key ? replies.get(r.thread_key) ?? 0 : 0,
    })),
    total, page, pages: Math.max(1, Math.ceil(total / pageSize)), counts, channels, missing: false,
  };
}

/** The people who can be assigned a message in a channel: the whole workspace, or the channel's team plus admins. */
export async function assignableMembers(admin: SupabaseClient, tenantId: string, channel: Pick<InboxChannel, "role_ids">): Promise<{ user_id: string; name: string | null; email: string | null }[]> {
  const { data: rows } = await admin.from("tenant_users").select("user_id, role").eq("tenant_id", tenantId).limit(200);
  let members = (rows ?? []) as { user_id: string; role: string }[];
  if (channel.role_ids.length > 0) {
    const { data: held } = await admin.from("business_user_roles").select("user_id").eq("tenant_id", tenantId).in("role_id", channel.role_ids);
    const team = new Set(((held ?? []) as { user_id: string }[]).map((h) => h.user_id));
    members = members.filter((m) => m.role === "admin" || team.has(m.user_id));
  }
  const people = await Promise.all(members.map(async (m) => {
    const { data } = await admin.auth.admin.getUserById(m.user_id);
    return { user_id: m.user_id, name: (data.user?.user_metadata?.full_name as string | undefined) ?? null, email: data.user?.email ?? null };
  }));
  return people.sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));
}

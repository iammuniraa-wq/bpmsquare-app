import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/encryption";
import { emitEmailReceived } from "@/lib/events/emitters";
import type { TenantFeatures } from "@/lib/constants";
import {
  INBOX_LIMITS, type InboxChannel,
} from "./types";
import {
  attachmentQuality, bodyFrom, expiryOnReceipt, messageIdList, normaliseMessageId, parseAddress, parseAliasAddress, safeFileName, skipReason,
  snippetOf, sniffAttachment, threadKeyFor, channelAddress,
} from "./rules";
import { ATTACHMENT_BUCKET, isMissingRelation, toChannel } from "./server";

// Mail in. One normalised shape (`InboxMail`) for both intakes:
//   A. the forwarding address: the signed inbound webhook hands us a message and the alias it was sent to;
//   B. the client's own mailbox: the poller hands us a message and the channel it read it for.
// The tenant and the channel come ONLY from the alias or the connector, never from the payload. Everything about the
// message is untrusted text: stored, never obeyed, never fetched.

export type InboxMail = {
  provider: string;
  providerMessageId: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  from: string | null;
  to: string[];
  subject: string;
  text: string;
  html: string | null;
  headers: Record<string, string>;
  /** When the sender's server dated it (a poll finds mail that is days old). Absent: now. Never in the future. */
  date?: string | null;
  attachments: { filename: string; contentType: string; content: Buffer }[];
};

export type IngestResult =
  | { ok: true; tenantId: string; channelId: string; emailId: string; duplicate: boolean; attachments: number }
  | { ok: false; reason: string };

/** The channel a platform-delivered message was addressed to, or null. Only an active channel of a workspace that owns the module. */
export async function routeByAlias(admin: SupabaseClient, mail: Pick<InboxMail, "to">, domain: string | null | undefined): Promise<
  { channel: InboxChannel } | { reason: string }
> {
  const d = (domain ?? "").trim().toLowerCase();
  if (!d) return { reason: "inbound domain not configured" };
  const aliases = [...new Set(mail.to.map((t) => parseAliasAddress(t, d)).filter((a): a is string => !!a))];
  if (aliases.length === 0) return { reason: "not an inbox address" };
  for (const alias of aliases) {
    const { data, error } = await admin.from("inbox_channels").select("*").eq("address_alias", alias).maybeSingle();
    if (error) return { reason: isMissingRelation(error) ? "inbox tables missing" : "lookup failed" };
    if (!data) continue;
    return { channel: toChannel(data as Record<string, unknown>) };
  }
  return { reason: "unknown inbox address" };
}

async function moduleOn(admin: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  return !!(data?.features as TenantFeatures | undefined)?.inbox;
}

/** Store the files of one message. Returns the rows written. A file that fails any rule is skipped, never the message. */
export async function storeAttachments(admin: SupabaseClient, tenantId: string, emailId: string, files: InboxMail["attachments"]): Promise<number> {
  const rows: Record<string, unknown>[] = [];
  for (const f of files.slice(0, INBOX_LIMITS.maxAttachmentsPerMessage)) {
    if (!f.content?.length || f.content.length > INBOX_LIMITS.maxAttachmentBytes) continue;
    const sniffed = sniffAttachment(f.content, f.filename);
    if (!sniffed.ok) continue;
    const path = `${tenantId}/inbox/${emailId}/${randomUUID()}.${sniffed.ext}`;
    const { error } = await admin.storage.from(ATTACHMENT_BUCKET).upload(path, f.content, { contentType: sniffed.mime, upsert: false });
    if (error) {
      console.error("[inbox] attachment upload failed", error.message);
      continue;
    }
    const q = attachmentQuality(sniffed.ext, f.content.length);
    rows.push({
      tenant_id: tenantId, email_id: emailId, file_name: safeFileName(f.filename, sniffed.ext), storage_path: path,
      mime_type: sniffed.mime, ext: sniffed.ext, size_bytes: f.content.length, quality: q.quality, quality_note: q.note,
    });
  }
  if (rows.length === 0) return 0;
  const { error } = await admin.from("inbound_email_attachments").insert(rows.map((r) => ({ ...r, tenant_id: tenantId })));
  if (error) {
    console.error("[inbox] attachment rows failed", error.message);
    await admin.storage.from(ATTACHMENT_BUCKET).remove(rows.map((r) => r.storage_path as string));
    return 0;
  }
  return rows.length;
}

/**
 * Take one message into a channel. Idempotent: the same provider message id, or the same RFC Message-ID in the same
 * channel, lands once (a webhook retry, a re-poll, or the same mail arriving by both intakes). Auto-replies, bounces and
 * our own mail are refused (the loop guard); a channel that is flooded stops taking mail for the hour.
 */
export async function ingestInboxMail(admin: SupabaseClient, channel: InboxChannel, mail: InboxMail, opts: { mailboxAddress?: string | null; now?: Date } = {}): Promise<IngestResult> {
  const tenantId = channel.tenant_id;
  if (!channel.active) return { ok: false, reason: "channel paused" };
  if (!(await moduleOn(admin, tenantId))) return { ok: false, reason: "inbox not enabled" };

  const domain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
  const own = [channelAddress(channel.address_alias, domain), channel.reply_from, opts.mailboxAddress];
  const skip = skipReason(mail.headers, mail.from, mail.subject, own);
  if (skip) return { ok: false, reason: skip };

  const now = opts.now ?? new Date();
  const providerId = (mail.providerMessageId ?? mail.messageId ?? "").slice(0, 300);
  if (!providerId) return { ok: false, reason: "no message id" };
  const messageId = normaliseMessageId(mail.messageId);

  // Idempotency before any work.
  {
    const a = await admin.from("inbound_emails").select("id").eq("tenant_id", tenantId).eq("provider_message_id", providerId).maybeSingle();
    if (a.error && isMissingRelation(a.error)) return { ok: false, reason: "inbox tables missing" };
    if (a.data) return { ok: true, tenantId, channelId: channel.id, emailId: (a.data as { id: string }).id, duplicate: true, attachments: 0 };
    if (messageId) {
      const b = await admin.from("inbound_emails").select("id").eq("tenant_id", tenantId).eq("channel_id", channel.id).eq("message_id", messageId).eq("direction", "in").maybeSingle();
      if (b.data) return { ok: true, tenantId, channelId: channel.id, emailId: (b.data as { id: string }).id, duplicate: true, attachments: 0 };
    }
  }

  // A flood (or a loop that got past the headers) must not fill the table.
  {
    const since = new Date(now.getTime() - 3_600_000).toISOString();
    const r = await admin.from("inbound_emails").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("channel_id", channel.id).eq("direction", "in").gte("created_at", since);
    if ((r.count ?? 0) >= INBOX_LIMITS.maxPerChannelPerHour) return { ok: false, reason: "rate limit" };
  }

  // Which conversation is it? The thread of the message it answers, when that one is ours.
  const refIds = [...messageIdList(mail.references), ...(normaliseMessageId(mail.inReplyTo) ? [normaliseMessageId(mail.inReplyTo)!] : [])];
  type Parent = { thread_key: string | null; linked_object_type: string | null; linked_object_id: string | null; linked_object_label: string | null };
  let parent = null as Parent | null;
  if (refIds.length > 0) {
    const { data } = await admin.from("inbound_emails").select("thread_key, linked_object_type, linked_object_id, linked_object_label")
      .eq("tenant_id", tenantId).eq("channel_id", channel.id).in("message_id", [...new Set(refIds)].slice(0, 20))
      .order("received_at", { ascending: false }).limit(1);
    parent = ((data ?? [])[0] as Parent | undefined) ?? null;
  }
  const threadKey = threadKeyFor(mail, parent?.thread_key ?? null);

  const body = bodyFrom(mail);
  const { name, address } = parseAddress(mail.from);
  const id = randomUUID();
  const dated = mail.date ? new Date(mail.date) : null;
  const received = dated && Number.isFinite(dated.getTime()) && dated.getTime() <= now.getTime() ? dated : now;
  const receivedAt = received.toISOString();
  const row = {
    id, tenant_id: tenantId, channel_id: channel.id, direction: "in", provider: mail.provider.slice(0, 60), provider_message_id: providerId,
    message_id: messageId, in_reply_to: normaliseMessageId(mail.inReplyTo), references_ids: (mail.references ?? "").slice(0, 2000) || null,
    thread_key: threadKey, from_address: address ?? ((mail.from ?? "").slice(0, 320) || null), from_name: name ? name.slice(0, 200) : null,
    to_addresses: mail.to.slice(0, 20).map((t) => t.slice(0, 320)),
    subject: (mail.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, INBOX_LIMITS.maxSubjectChars),
    body_text: encrypt(body) ?? "", snippet: encrypt(snippetOf(body)) ?? "",
    received_at: receivedAt, status: "new", expires_at: expiryOnReceipt(received).toISOString(),
    // A reply on a conversation already turned into a record keeps pointing at that record.
    linked_object_type: parent?.linked_object_type ?? null, linked_object_id: parent?.linked_object_id ?? null, linked_object_label: parent?.linked_object_label ?? null,
  };
  const { error } = await admin.from("inbound_emails").insert({ ...row, tenant_id: tenantId });
  if (error) {
    if (error.code === "23505") {
      const dup = await admin.from("inbound_emails").select("id").eq("tenant_id", tenantId).eq("provider_message_id", providerId).maybeSingle();
      return { ok: true, tenantId, channelId: channel.id, emailId: (dup.data as { id: string } | null)?.id ?? id, duplicate: true, attachments: 0 };
    }
    if (isMissingRelation(error)) return { ok: false, reason: "inbox tables missing" };
    return { ok: false, reason: error.message };
  }

  const attachments = await storeAttachments(admin, tenantId, id, mail.attachments);
  await admin.from("inbox_channels").update({ last_received_at: receivedAt }).eq("id", channel.id).eq("tenant_id", tenantId);
  await emitEmailReceived(tenantId, { emailId: id, channelId: channel.id, attachments, replyInThread: !!parent });
  return { ok: true, tenantId, channelId: channel.id, emailId: id, duplicate: false, attachments };
}

import "server-only";
import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "@/lib/constants";
import { encrypt } from "@/lib/encryption";
import { emailOutputFor, resolveOutbound } from "@/lib/emailOutput";
import { logEmail } from "@/lib/emailLog";
import { loadMailbox, sendViaMailbox, type Mailbox, type OutgoingMail } from "@/lib/mail/mailbox";
import type { InboxChannel } from "./types";
import { INBOX_LIMITS } from "./types";
import { channelAddress, cleanBody, normaliseMessageId, OUR_LOOP_HEADER_SENT, outgoingMessageId, parseAddress, replyHeaders, replySubject, snippetOf } from "./rules";

// Reply from the Inbox. The reply goes ONLY to the person who wrote (never to an address typed into the request, so the
// Inbox cannot be used to mail strangers), always through resolveOutbound (a demo workspace cannot reach a customer),
// out through the channel's own mailbox when it has one and BPMSquare's sender otherwise, threaded so the customer's mail
// program files it under the same conversation. The sent message is stored as an 'out' row in the thread and logged in
// email_log (kind inbox).

export type ReplyResult =
  | { ok: true; via: "platform" | "mailbox"; redirected: boolean; to: string[]; emailId: string }
  | { ok: false; reason: string; status: number };

type TenantRow = { id: string; slug: string; name: string; is_demo: boolean | null; config: TenantConfig | null; company_info: { email?: string } | null };

export type ReplyDeps = {
  loadMailbox?: typeof loadMailbox;
  sendViaMailbox?: (mb: Mailbox, mail: OutgoingMail) => ReturnType<typeof sendViaMailbox>;
  sendViaPlatform?: (payload: {
    from: string; to: string[]; replyTo?: string; subject: string; text: string; headers: Record<string, string>;
  }) => Promise<{ error?: string | null }>;
  now?: Date;
};

async function defaultPlatformSend(payload: Parameters<NonNullable<ReplyDeps["sendViaPlatform"]>>[0]): Promise<{ error?: string | null }> {
  if (!process.env.RESEND_API_KEY) return { error: "Email sending isn't configured (missing RESEND_API_KEY)." };
  const resend = new Resend(process.env.RESEND_API_KEY);
  const r = await resend.emails.send({
    from: payload.from, to: payload.to, replyTo: payload.replyTo, subject: payload.subject, text: payload.text, headers: payload.headers,
  });
  return { error: r.error?.message ?? null };
}

const domainOf = (addr: string | null | undefined) => (parseAddress(addr).address ?? "").split("@")[1] ?? "";

export async function sendReply(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    channel: InboxChannel;
    /** The customer's message being answered (an 'in' row, decrypted). */
    original: { id: string; from_address: string | null; from_name: string | null; subject: string; message_id: string | null; references_ids: string | null; thread_key: string | null; expires_at: string };
    body: string;
    actor: { id: string | null; email: string | null };
  },
  deps: ReplyDeps = {},
): Promise<ReplyResult> {
  const { tenantId, channel, original } = args;
  const text = cleanBody(args.body, 20_000);
  if (!text) return { ok: false, reason: "Write a reply first.", status: 400 };
  const to = parseAddress(original.from_address).address;
  if (!to) return { ok: false, reason: "This message has no sender address to reply to.", status: 422 };

  const { data: t } = await admin.from("tenants").select("id, slug, name, is_demo, config, company_info").eq("id", tenantId).maybeSingle();
  const tenant = t as TenantRow | null;
  if (!tenant) return { ok: false, reason: "Workspace not found.", status: 404 };

  const subject = replySubject(original.subject);
  const routed = resolveOutbound(emailOutputFor({ is_demo: tenant.is_demo, config: tenant.config }), { to: [to], subject, text });
  if (!routed.ok) return { ok: false, reason: routed.error, status: 400 };
  const mail = routed.email;

  const sendingDomain = (process.env.RESEND_SENDING_DOMAIN || "bpmsquare.com").toLowerCase();
  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase();
  const messageId = outgoingMessageId(randomUUID(), sendingDomain);
  const threading = replyHeaders({ message_id: original.message_id, references: original.references_ids });
  const fromName = (channel.reply_name?.trim() || tenant.name).slice(0, 120);

  let via: "platform" | "mailbox" = "platform";
  let fromAddress: string;
  let sendError: string | null = null;

  const mb = channel.connector_id ? await (deps.loadMailbox ?? loadMailbox)(admin, tenantId, channel.connector_id) : null;
  if (channel.connector_id && !mb) {
    return { ok: false, reason: `This channel replies from your own mailbox, but the ${channel.connector_id === "gmail" ? "Gmail" : "Mail server"} connector isn't connected (Settings → Connectors).`, status: 409 };
  }
  if (mb) {
    via = "mailbox";
    fromAddress = mb.address;
    const res = await (deps.sendViaMailbox ?? sendViaMailbox)(mb, {
      fromName, to: mail.to, subject: mail.subject, text: mail.text, messageId,
      inReplyTo: threading.inReplyTo, references: threading.references, headers: { [OUR_LOOP_HEADER_SENT]: "1" },
    });
    if (!res.ok) sendError = res.error;
  } else {
    const wanted = parseAddress(channel.reply_from).address;
    const ours = wanted && [sendingDomain, inboundDomain].includes(domainOf(wanted));
    fromAddress = ours ? wanted! : `${(tenant.slug || "inbox").toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${sendingDomain}`;
    // Replies come back to the channel's own address so they land in the same conversation; the one exception is a
    // platform without an inbound domain, where the reply-from (or the company address) is the best we can offer.
    const replyTo = (inboundDomain && channelAddress(channel.address_alias, inboundDomain)) || wanted || tenant.company_info?.email || undefined;
    const headers: Record<string, string> = { "Message-ID": messageId, [OUR_LOOP_HEADER_SENT]: "1" };
    if (threading.inReplyTo) headers["In-Reply-To"] = threading.inReplyTo;
    if (threading.references) headers["References"] = threading.references;
    const r = await (deps.sendViaPlatform ?? defaultPlatformSend)({ from: `${fromName} <${fromAddress}>`, to: mail.to, replyTo, subject: mail.subject, text: mail.text, headers });
    if (r.error) sendError = r.error;
  }

  const now = deps.now ?? new Date();
  const emailId = randomUUID();
  const { error: insertErr } = await admin.from("inbound_emails").insert({
    id: emailId, tenant_id: tenantId, channel_id: channel.id, direction: "out", provider: via, provider_message_id: `out:${normaliseMessageId(messageId)}`,
    message_id: normaliseMessageId(messageId), in_reply_to: normaliseMessageId(original.message_id), references_ids: threading.references ?? null,
    thread_key: original.thread_key, from_address: fromAddress, from_name: fromName, to_addresses: mail.to, subject: mail.subject.slice(0, INBOX_LIMITS.maxSubjectChars),
    body_text: encrypt(text) ?? "", snippet: encrypt(snippetOf(text)) ?? "",
    received_at: now.toISOString(), status: "handled", expires_at: original.expires_at,
    send_status: sendError ? "failed" : mail.redirected ? "redirected" : "sent", error: sendError, created_by: args.actor.id,
  });
  if (insertErr) console.error("[inbox] could not store the sent reply", insertErr.message);

  await logEmail(admin, {
    tenantId, kind: "inbox", toEmail: mail.to.join(", "), subject: mail.subject, status: sendError ? "failed" : "sent", error: sendError,
    relatedObjectType: "inbound_emails", relatedObjectId: original.id, relatedObjectLabel: `${channel.name} reply`,
    actorId: args.actor.id, actorEmail: args.actor.email,
  });
  if (sendError) return { ok: false, reason: `Send failed: ${sendError}`, status: 502 };
  return { ok: true, via, redirected: mail.redirected, to: mail.to, emailId };
}

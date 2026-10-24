import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InboundEmail } from "@/lib/rfq/inbound";
import { ingestInboxMail, routeByAlias, type IngestResult } from "./ingest";

/**
 * Intake A: a message the inbound webhook received that is not an RFQ reply. It belongs to the Inbox only if one of its
 * recipients is a channel's own forwarding address (inbox-<random>@INBOUND_EMAIL_DOMAIN). The channel row names the
 * workspace; nothing in the message does. An unknown address is not an error: the caller answers 200 and moves on.
 */
export async function ingestPlatformMail(admin: SupabaseClient, mail: InboundEmail): Promise<IngestResult> {
  const routed = await routeByAlias(admin, mail, process.env.INBOUND_EMAIL_DOMAIN);
  if (!("channel" in routed)) return { ok: false, reason: routed.reason };
  return ingestInboxMail(admin, routed.channel, {
    provider: mail.provider,
    providerMessageId: mail.providerMessageId,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references ?? null,
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    headers: mail.headers ?? {},
    attachments: mail.attachments,
  });
}

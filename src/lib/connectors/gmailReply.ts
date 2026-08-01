import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { getDecryptedCredentials } from "./server";

// Threading a quote email into the customer's original inbound conversation,
// using the SAME Gmail App Password the tenant already saved for the "gmail"
// connector (Settings -> Connectors) -- a Google App Password authenticates
// both SMTP (send, already used by the connector's test action) and IMAP
// (read), so no separate OAuth integration is needed to add this. Standard
// product functionality, not tenant-specific: any tenant with a connected
// Gmail account gets it, on any object that sends a quote email.

export type GmailCredentials = { email: string; appPassword: string };

export async function getGmailConnectorCredentials(supabase: SupabaseClient, tenantId: string): Promise<GmailCredentials | null> {
  const creds = await getDecryptedCredentials(supabase, tenantId, "gmail");
  if (!creds?.email || !creds?.app_password) return null;
  return { email: creds.email, appPassword: creds.app_password };
}

/** Drops leading Re:/Fwd: (any casing, any repeat count) so what's left can
 * be used both as an IMAP substring search term and as the reply subject's
 * own core text -- searching with a stray "Re: " prefix the original inbound
 * subject never had would never match. */
export function stripReplyPrefixes(subject: string): string {
  return subject.replace(/^\s*(re|fwd?)\s*:\s*/i, "").replace(/^\s*(re|fwd?)\s*:\s*/i, "").trim();
}

export function buildReplySubject(coreSubject: string): string {
  return `Re: ${coreSubject}`;
}

/**
 * Searches the connected Gmail inbox for the most recent message from
 * `fromAddress` (optionally narrowed by a subject substring) and returns its
 * Message-ID header for threading. Read-only, never modifies the mailbox.
 * Returns null on no match OR on any IMAP failure -- callers treat both the
 * same way: fall back to a normal (non-threaded) send, never block on this.
 */
export async function findOriginalMessage(
  creds: GmailCredentials,
  fromAddress: string,
  subjectHint: string
): Promise<{ messageId: string; subject: string } | null> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: creds.email, pass: creds.appPassword },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const criteria: Record<string, string> = { from: fromAddress };
      const core = stripReplyPrefixes(subjectHint).trim();
      if (core.length >= 3) criteria.subject = core;

      const uids = await client.search(criteria, { uid: true });
      if (!uids || uids.length === 0) return null;

      const lastUid = uids[uids.length - 1];
      const msg = await client.fetchOne(lastUid, { envelope: true }, { uid: true });
      if (!msg || !msg.envelope?.messageId) return null;
      return { messageId: msg.envelope.messageId, subject: msg.envelope.subject ?? "" };
    } finally {
      lock.release();
    }
  } catch (e) {
    console.error("[gmailReply] IMAP search failed", e);
    return null;
  } finally {
    try { await client.logout(); } catch { /* best-effort */ }
  }
}

export type GmailSendResult = { ok: true } | { ok: false; error: string };

/** Sends through the tenant's own connected Gmail account via SMTP -- the
 * reply lands in Vikas's real Sent history and, when inReplyTo/references
 * are set, in the same conversation thread on both ends. */
export async function sendViaGmail(creds: GmailCredentials, options: {
  fromDisplayName: string;
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
  inReplyTo?: string;
  references?: string;
}): Promise<GmailSendResult> {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: creds.email, pass: creds.appPassword },
  });

  try {
    await transporter.sendMail({
      from: `"${options.fromDisplayName}" <${creds.email}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      attachments: options.attachments,
      inReplyTo: options.inReplyTo,
      references: options.references,
    });
    return { ok: true };
  } catch (e) {
    const err = e as { message?: string };
    return { ok: false, error: err.message ?? "Gmail rejected the send" };
  }
}

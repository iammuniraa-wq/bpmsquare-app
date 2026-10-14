import "server-only";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDecryptedCredentials } from "@/lib/connectors/server";
import { assertPublicHost } from "@/lib/net/safeHost";

// A tenant's OWN mailbox as a two-way mail channel: send over SMTP, read
// replies over IMAP. Backs RFQ "mailbox" mode (config.rfq.mail_mode), and is
// deliberately generic -- any object that later wants a conversation in the
// tenant's own mailbox uses this, not a copy of it.
//
// Two connectors feed it:
//   gmail        the existing Gmail App Password connector (fixed hosts)
//   mail_server  any SMTP/IMAP server: Zoho, cPanel/Exchange IMAP, a hosting
//                provider's mail -- host, ports, username, password
//
// The host is tenant-typed and our server connects to it, so it is checked
// against private/internal addresses before every connection (net/safeHost).

export type MailboxEndpoint = { host: string; port: number; secure: boolean };
export type Mailbox = {
  connectorId: "gmail" | "mail_server";
  address: string;
  user: string;
  pass: string;
  smtp: MailboxEndpoint;
  imap: MailboxEndpoint;
};

function port(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : d;
}

export async function loadMailbox(admin: SupabaseClient, tenantId: string, connectorId: "gmail" | "mail_server"): Promise<Mailbox | null> {
  const creds = await getDecryptedCredentials(admin, tenantId, connectorId);
  if (!creds) return null;
  if (connectorId === "gmail") {
    if (!creds.email || !creds.app_password) return null;
    return {
      connectorId, address: creds.email, user: creds.email, pass: creds.app_password,
      smtp: { host: "smtp.gmail.com", port: 587, secure: false },
      imap: { host: "imap.gmail.com", port: 993, secure: true },
    };
  }
  // mail_server keeps its non-secret fields in `config`, the password in
  // `credentials`; getDecryptedCredentials only returns the latter.
  const { data } = await admin.from("tenant_connectors").select("config").eq("tenant_id", tenantId).eq("connector_id", "mail_server").maybeSingle();
  const cfg = (data?.config ?? {}) as Record<string, string>;
  if (!cfg.email || !cfg.smtp_host || !cfg.imap_host || !creds.password) return null;
  const smtpPort = port(cfg.smtp_port, 587);
  const imapPort = port(cfg.imap_port, 993);
  return {
    connectorId, address: cfg.email, user: cfg.username || cfg.email, pass: creds.password,
    smtp: { host: cfg.smtp_host, port: smtpPort, secure: smtpPort === 465 },
    imap: { host: cfg.imap_host, port: imapPort, secure: imapPort !== 143 },
  };
}

export type OutgoingMail = {
  fromName: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
};

export async function sendViaMailbox(mb: Mailbox, mail: OutgoingMail): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  try {
    await assertPublicHost(mb.smtp.host);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const transporter = nodemailer.createTransport({
    host: mb.smtp.host,
    port: mb.smtp.port,
    secure: mb.smtp.secure,
    auth: { user: mb.user, pass: mb.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  try {
    const info = await transporter.sendMail({
      from: { name: mail.fromName, address: mb.address },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      replyTo: mail.replyTo,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      attachments: mail.attachments,
    });
    return { ok: true, messageId: (info.messageId as string | undefined) ?? mail.messageId ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "The mail server rejected the send" };
  }
}

export type FetchedAttachment = { filename: string; contentType: string; content: Buffer };
export type FetchedMail = {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  from: string | null;
  to: string[];
  subject: string;
  date: string | null;
  text: string;
  html: string | null;
  attachments: FetchedAttachment[];
};

type BodyNode = {
  part?: string;
  type?: string;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  parameters?: Record<string, string>;
  size?: number;
  childNodes?: BodyNode[];
};

function walk(node: BodyNode, out: { text?: string; html?: string; files: { part: string; filename: string; type: string; size: number }[] }) {
  if (node.childNodes?.length) {
    for (const c of node.childNodes) walk(c, out);
    return;
  }
  const type = (node.type ?? "").toLowerCase();
  const part = node.part ?? "1";
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name ?? null;
  const isAttachment = (node.disposition ?? "").toLowerCase() === "attachment" || (!!filename && !type.startsWith("text/"));
  if (isAttachment && filename) {
    out.files.push({ part, filename, type, size: node.size ?? 0 });
  } else if (type === "text/plain" && !out.text) {
    out.text = part;
  } else if (type === "text/html" && !out.html) {
    out.html = part;
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * New messages since `lastUid` whose subject passes `wanted` (cheap envelope
 * check first, so unrelated mail is never downloaded). First run (lastUid 0
 * or a changed uidValidity) looks back `firstRunDays` only -- never the whole
 * inbox. Read-only: nothing is flagged, moved or deleted.
 */
export async function fetchNewMail(mb: Mailbox, state: { uidValidity: bigint | null; lastUid: number }, opts: {
  wanted: (subject: string, inReplyTo: string | null) => boolean;
  maxMessages: number;
  maxAttachmentBytes: number;
  firstRunDays: number;
}): Promise<{ uidValidity: bigint; lastUid: number; messages: FetchedMail[] }> {
  await assertPublicHost(mb.imap.host);
  const client = new ImapFlow({
    host: mb.imap.host,
    port: mb.imap.port,
    secure: mb.imap.secure,
    auth: { user: mb.user, pass: mb.pass },
    logger: false,
    socketTimeout: 60_000,
  });
  const messages: FetchedMail[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box = client.mailbox as unknown as { uidValidity: bigint; uidNext: number };
      const validity = BigInt(box.uidValidity);
      const fresh = state.uidValidity === null || state.uidValidity !== validity || state.lastUid <= 0;
      let uids: number[];
      if (fresh) {
        const since = new Date(Date.now() - opts.firstRunDays * 86_400_000);
        uids = ((await client.search({ since }, { uid: true })) || []) as number[];
      } else {
        uids = ((await client.search({ uid: `${state.lastUid + 1}:*` }, { uid: true })) || []) as number[];
        uids = uids.filter((u) => u > state.lastUid);
      }
      uids.sort((a, b) => a - b);
      let lastUid = fresh ? 0 : state.lastUid;
      // Oldest first, bounded: anything past the cap is picked up next run.
      for (const uid of uids.slice(0, opts.maxMessages * 4)) {
        lastUid = Math.max(lastUid, uid);
        const msg = await client.fetchOne(String(uid), { envelope: true, bodyStructure: true, headers: ["in-reply-to"] }, { uid: true });
        if (!msg || !msg.envelope) continue;
        const subject = msg.envelope.subject ?? "";
        const headerText = msg.headers ? Buffer.from(msg.headers).toString("utf8") : "";
        const inReplyTo = /in-reply-to:\s*(<[^>]+>)/i.exec(headerText)?.[1] ?? null;
        if (!opts.wanted(subject, inReplyTo)) continue;
        if (messages.length >= opts.maxMessages) { lastUid = uid - 1; break; }

        const parts: { text?: string; html?: string; files: { part: string; filename: string; type: string; size: number }[] } = { files: [] };
        if (msg.bodyStructure) walk(msg.bodyStructure as unknown as BodyNode, parts);
        const read = async (part: string, limit: number) => {
          const dl = await client.download(String(uid), part, { uid: true });
          return dl?.content ? streamToBuffer(dl.content, limit) : null;
        };
        const text = parts.text ? ((await read(parts.text, 512 * 1024))?.toString("utf8") ?? "") : "";
        const html = parts.html ? ((await read(parts.html, 1024 * 1024))?.toString("utf8") ?? null) : null;
        const attachments: FetchedAttachment[] = [];
        for (const f of parts.files.slice(0, 10)) {
          if (f.size > opts.maxAttachmentBytes * 1.4) continue; // base64 size on the wire
          const buf = await read(f.part, opts.maxAttachmentBytes);
          if (buf) attachments.push({ filename: f.filename, contentType: f.type || "application/octet-stream", content: buf });
        }
        const from = msg.envelope.from?.[0]?.address ?? null;
        messages.push({
          uid,
          messageId: msg.envelope.messageId ?? null,
          inReplyTo: inReplyTo ?? msg.envelope.inReplyTo ?? null,
          from,
          to: (msg.envelope.to ?? []).map((a) => a.address ?? "").filter(Boolean),
          subject,
          date: msg.envelope.date ? new Date(msg.envelope.date).toISOString() : null,
          text,
          html,
          attachments,
        });
      }
      return { uidValidity: validity, lastUid, messages };
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch { /* best-effort */ }
  }
}

/** Connector test: log in to both servers, send nothing. */
export async function testMailbox(mb: Mailbox): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertPublicHost(mb.smtp.host);
    await assertPublicHost(mb.imap.host);
    const transporter = nodemailer.createTransport({
      host: mb.smtp.host, port: mb.smtp.port, secure: mb.smtp.secure,
      auth: { user: mb.user, pass: mb.pass }, connectionTimeout: 15_000,
    });
    await transporter.verify();
    const client = new ImapFlow({ host: mb.imap.host, port: mb.imap.port, secure: mb.imap.secure, auth: { user: mb.user, pass: mb.pass }, logger: false });
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Could not log in" };
  }
}

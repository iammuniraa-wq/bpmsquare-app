import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { verifySvix, verifyGeneric } from "@/lib/mail/webhookSignature";
import { ingestInbound, type InboundEmail } from "@/lib/rfq/inbound";
import { ingestPlatformMail } from "@/lib/inbox/platform";
import { assertSafeHttpsUrl } from "@/lib/net/safeHost";
import { RFQ_LIMITS } from "@/lib/rfq/types";

// Inbound email webhook -- the "platform" mail channel's receiving half.
// No session: the credential is the provider's signature, checked before
// anything is read. Which tenant and which RFQ a message belongs to comes
// ONLY from the signed reply-to address it was sent to (lib/rfq/token.ts),
// never from anything else in the payload.
//
//   POST /api/inbound/email/resend    Resend "email.received" (Svix-signed,
//                                     RESEND_INBOUND_WEBHOOK_SECRET); the body
//                                     and files are fetched from Resend's API
//   POST /api/inbound/email/generic   any relay that can POST JSON, signed
//                                     with INBOUND_EMAIL_SECRET (see
//                                     verifyGeneric for the header format):
//     { from, to: [], subject, text?, html?, message_id?, in_reply_to?,
//       attachments?: [{ filename, content_type, content_base64 }] }
//
// The RFQ router goes first. A message that is not an RFQ reply is offered to
// the shared Inbox: it is kept only if it was sent to a channel's own
// forwarding address (lib/inbox/platform.ts), and that channel -- not the
// payload -- names the workspace.
//
// Always 200 for a verified message we choose not to keep (not an RFQ reply,
// not an Inbox address, an auto-reply), so the provider doesn't retry it forever.

export const maxDuration = 60;

const RESEND_API = "https://api.resend.com";

async function resendJson(path: string): Promise<unknown> {
  const res = await fetch(`${RESEND_API}${path}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`Resend ${path} returned ${res.status}`);
  return res.json();
}

async function download(url: string, limit: number): Promise<Buffer | null> {
  await assertSafeHttpsUrl(url);
  const res = await fetch(url, { redirect: "error", cache: "no-store" });
  if (!res.ok) return null;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > limit) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > limit ? null : buf;
}

async function fromResend(emailId: string): Promise<InboundEmail> {
  const e = (await resendJson(`/emails/receiving/${encodeURIComponent(emailId)}`)) as {
    id: string; from?: string; to?: string[]; cc?: string[]; subject?: string; html?: string | null; text?: string | null;
    message_id?: string | null; headers?: Record<string, string>;
  };
  const files: InboundEmail["attachments"] = [];
  try {
    const list = (await resendJson(`/emails/receiving/${encodeURIComponent(emailId)}/attachments`)) as {
      data?: { filename?: string; size?: number; content_type?: string; content_disposition?: string; download_url?: string }[];
    };
    for (const a of (list.data ?? []).slice(0, RFQ_LIMITS.maxAttachmentsPerMessage)) {
      if (!a.download_url || (a.size ?? 0) > RFQ_LIMITS.maxAttachmentBytes || a.content_disposition === "inline") continue;
      const buf = await download(a.download_url, RFQ_LIMITS.maxAttachmentBytes).catch(() => null);
      if (buf) files.push({ filename: a.filename ?? "attachment", contentType: a.content_type ?? "application/octet-stream", content: buf });
    }
  } catch (err) {
    console.error("[inbound] resend attachments", err);
  }
  const headers = Object.fromEntries(Object.entries(e.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    provider: "resend",
    providerMessageId: e.id,
    from: e.from ?? null,
    to: [...(e.to ?? []), ...(e.cc ?? [])],
    subject: e.subject ?? "",
    text: e.text ?? "",
    html: e.html ?? null,
    messageId: e.message_id ?? headers["message-id"] ?? null,
    inReplyTo: headers["in-reply-to"] ?? null,
    references: headers["references"] ?? null,
    headers,
    attachments: files,
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const raw = await req.text();
  if (raw.length > 30 * 1024 * 1024) return NextResponse.json({ error: "Too large" }, { status: 413 });

  let mail: InboundEmail;
  if (provider === "resend") {
    const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET ?? "";
    const ok = verifySvix(secret, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, raw);
    if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    let event: { type?: string; data?: { email_id?: string } };
    try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
    if (event.type !== "email.received" || !event.data?.email_id) return NextResponse.json({ ok: true, ignored: event.type ?? "unknown" });
    if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "RESEND_API_KEY missing" }, { status: 500 });
    try {
      mail = await fromResend(event.data.email_id);
    } catch (err) {
      console.error("[inbound] resend fetch failed", err);
      return NextResponse.json({ error: "Could not fetch the email" }, { status: 502 }); // provider retries
    }
  } else if (provider === "generic") {
    const secret = process.env.INBOUND_EMAIL_SECRET ?? "";
    if (!verifyGeneric(secret, req.headers.get("x-bpmsquare-signature"), raw)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    let p: { from?: string; to?: string[]; subject?: string; text?: string; html?: string; message_id?: string; in_reply_to?: string; references?: string; headers?: Record<string, unknown>; attachments?: { filename?: string; content_type?: string; content_base64?: string }[] };
    try { p = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
    const files: InboundEmail["attachments"] = [];
    for (const a of (p.attachments ?? []).slice(0, RFQ_LIMITS.maxAttachmentsPerMessage)) {
      if (typeof a.content_base64 !== "string") continue;
      const buf = Buffer.from(a.content_base64, "base64");
      if (buf.length && buf.length <= RFQ_LIMITS.maxAttachmentBytes) files.push({ filename: a.filename ?? "attachment", contentType: a.content_type ?? "application/octet-stream", content: buf });
    }
    mail = {
      provider: "generic", providerMessageId: p.message_id ?? null, from: p.from ?? null, to: Array.isArray(p.to) ? p.to.map(String) : [],
      subject: p.subject ?? "", text: p.text ?? "", html: p.html ?? null, messageId: p.message_id ?? null, inReplyTo: p.in_reply_to ?? null,
      references: typeof p.references === "string" ? p.references : null,
      headers: Object.fromEntries(Object.entries(p.headers ?? {}).filter(([, v]) => typeof v === "string").map(([k, v]) => [k.toLowerCase(), v as string])),
      attachments: files,
    };
  } else {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const admin = createAdminSupabase();
  const result = await ingestInbound(admin, mail);
  if (result.ok) return NextResponse.json({ ok: true, routed: true, duplicate: result.duplicate, prices_saved: result.pricesSaved });

  // Not an RFQ reply (the RFQ router always goes first). An address of a shared-Inbox channel? The channel the signed
  // alias names decides the workspace; any other address is dropped with a 200 so the provider does not retry it.
  const inbox = await ingestPlatformMail(admin, mail);
  if (inbox.ok) return NextResponse.json({ ok: true, routed: true, inbox: true, duplicate: inbox.duplicate, attachments: inbox.attachments });
  return NextResponse.json({ ok: true, routed: false, reason: inbox.reason === "not an inbox address" ? result.reason : inbox.reason });
}

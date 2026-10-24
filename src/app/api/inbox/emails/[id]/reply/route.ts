import { NextResponse, type NextRequest } from "next/server";
import { inboxAccess, errorResponse, loadEmailForViewer } from "@/lib/inbox/server";
import { sendReply } from "@/lib/inbox/reply";

export const maxDuration = 60;

// POST /api/inbox/emails/[id]/reply { body }  -> sends to the person who wrote, threaded, and stores the reply in the
// conversation. The recipient is never taken from the request: a reply can only go back to the sender, so the Inbox
// cannot be used to mail anyone else.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await inboxAccess(true);
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { body?: unknown } | null;
    const text = typeof body?.body === "string" ? body.body : "";
    const found = await loadEmailForViewer(ctx, id);
    if (!found) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    if (found.email.direction !== "in") return NextResponse.json({ error: "Reply to the customer's message." }, { status: 422 });
    if (!found.channel.active) return NextResponse.json({ error: "This channel is paused." }, { status: 409 });
    const r = await sendReply(ctx.admin, {
      tenantId: ctx.tenantId, channel: found.channel,
      original: {
        id: found.email.id, from_address: found.email.from_address, from_name: found.email.from_name, subject: found.email.subject,
        message_id: found.email.message_id, references_ids: found.email.references_ids, thread_key: found.email.thread_key, expires_at: found.email.expires_at,
      },
      body: text, actor: { id: ctx.userId, email: ctx.email },
    });
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status });
    return NextResponse.json({ ok: true, via: r.via, redirected: r.redirected, sent_to: r.to.join(", "), id: r.emailId });
  } catch (e) {
    return errorResponse(e);
  }
}

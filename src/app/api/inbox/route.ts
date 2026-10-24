import { NextResponse, type NextRequest } from "next/server";
import { inboxAccess, errorResponse, listEmails } from "@/lib/inbox/server";
import { INBOX_STATUSES, type InboxStatus } from "@/lib/inbox/types";

// GET /api/inbox?channel=&status=&q=&page=&mine=1 -> { emails, total, page, pages, counts, channels, pending_migration? }
// Only the channels the signed-in person may open are ever listed, searched or counted. No body text leaves here (the
// list carries a short snippet); the message itself is /api/inbox/emails/[id]. There is deliberately no POST: mail
// arrives by the inbound webhook and the mailbox poller, it is not typed in. No v1 endpoint: mail is private.

export async function GET(req: NextRequest) {
  try {
    const ctx = await inboxAccess(false);
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status");
    const r = await listEmails(ctx, {
      channel: sp.get("channel"),
      status: status && (INBOX_STATUSES as readonly string[]).includes(status) ? (status as InboxStatus) : "all",
      q: sp.get("q"),
      page: Number(sp.get("page")) || 1,
      pageSize: Number(sp.get("page_size")) || undefined,
      mine: sp.get("mine") === "1" ? ctx.userId : null,
    });
    return NextResponse.json({
      emails: r.emails, total: r.total, page: r.page, pages: r.pages, counts: r.counts,
      channels: r.channels.map((c) => ({ id: c.id, name: c.name, default_action: c.default_action, active: c.active })),
      ...(r.missing ? { pending_migration: true } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

import { NextResponse, NextRequest } from "next/server";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { parseCompose } from "@/lib/tender/interactions/rules";
import { loadInteractions, sendClientMessage } from "@/lib/tender/interactions/server";

// GET  /api/opportunities/[id]/tender/interactions -- the timeline of email with the client on this tender, newest first (the source
//   email, mail the Inbox filed under the tender, documents sent to the client, emails written here).
// POST /api/opportunities/[id]/tender/interactions { to, subject, body } -- write to the client. It goes through the tender's mail
//   (resolveOutbound: a demo workspace is redirected), is logged under Outbound emails and the change log, and lands on the timeline.
//   The workspace and the sender are the session's; nothing here reads them from the request.

export const maxDuration = 30;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  return NextResponse.json(await loadInteractions(gate.req), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const parsed = parseCompose(await request.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const sent = await sendClientMessage(gate.req, parsed.value);
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status });
  return NextResponse.json({ ok: true, redirected: sent.redirected, intended: sent.intended }, { status: 201 });
}

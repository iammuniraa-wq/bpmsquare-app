import { NextResponse, NextRequest } from "next/server";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { listBidVersions } from "@/lib/tender/bids/server";
import { parseSend } from "@/lib/tender/bids/rules";
import { listSends, recordSend } from "@/lib/tender/bids/sends";

// GET  /api/opportunities/[id]/tender/bids/sends -- what went to the client on this tender, newest first (migration 0237).
// POST /api/opportunities/[id]/tender/bids/sends { channel, document, to_text?, note?, version_no? } -- record a send by hand (a portal
//   upload, a letter). An email sent from the tender is recorded by send-email itself. Who sent it and the workspace are the session's.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, false);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId } = gate.req;
  return NextResponse.json(await listSends(admin, tenantId, id));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId } = gate.req;
  const versions = await listBidVersions(admin, tenantId, id);
  const parsed = parseSend(await request.json().catch(() => ({})), versions.versions.map((v) => v.version_no));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });
  const saved = await recordSend(gate.req, parsed.value);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
  return NextResponse.json({ ok: true, id: saved.id }, { status: 201 });
}

import { NextResponse, NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { exportAnswerSheet, exportPriced } from "@/lib/tender/boq/server";
import { defaultMailer, loadNotifyTenant, sendTenderMailDetailed } from "@/lib/tender/notify";
import { SEND_DOCUMENT_LABEL, parseEmailSend, sendToText } from "@/lib/tender/bids/rules";
import { listSends, recordSend, PENDING_SENDS } from "@/lib/tender/bids/sends";

// POST /api/opportunities/[id]/tender/bids/send-email { document: "priced_boq" | "answer_sheet", to, note? }
//
// Builds the file with the same writers as the downloads (the selling rate and amount only: no cost, no markup), sends it as an
// attachment through resolveOutbound (a demo workspace is redirected), logs it under Outbound emails, and records it under Sent to
// client. The records table is checked BEFORE anything is sent, so a send is never left unrecorded.

export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, tenantId, userId, opp, tender } = gate.req;

  const parsed = parseEmailSend(await request.json().catch(() => ({})));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { document, to, note } = parsed.value;

  const mailer = defaultMailer();
  if (!mailer) return NextResponse.json({ error: "Email is not set up on this server" }, { status: 503 });
  const records = await listSends(admin, tenantId, id);
  if (records.pending) return NextResponse.json({ error: PENDING_SENDS }, { status: 503 });
  const tenant = await loadNotifyTenant(admin, tenantId);
  if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const file = document === "priced_boq" ? await exportPriced(gate.req) : await exportAnswerSheet(gate.req);
  if (!file.ok) return NextResponse.json({ error: file.error }, { status: file.status });

  const user = await getAuthUser();
  const label = SEND_DOCUMENT_LABEL[document];
  const result = await sendTenderMailDetailed(admin, tenant, {
    to: [to], subject: `${tender.tender_no ?? opp.ref ?? opp.title} · ${label}`,
    text: `${note ? `${note}\n\n` : ""}Attached: ${file.fileName}`,
    dealId: id, dealLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), actorId: user?.id ?? userId, actorEmail: user?.email,
    attachments: [{ filename: file.fileName, content: file.buffer }],
  }, mailer);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.stage === "route" ? 409 : 502 });

  const saved = await recordSend(gate.req, { channel: "email", document, to_text: sendToText(result), note, version_no: null });
  if (!saved.ok) return NextResponse.json({ error: `The email went, but it could not be recorded: ${saved.error}` }, { status: saved.status });
  return NextResponse.json({ ok: true, redirected: result.redirected, to: result.to, intended: result.intended, unpriced: file.unpriced }, { status: 201 });
}

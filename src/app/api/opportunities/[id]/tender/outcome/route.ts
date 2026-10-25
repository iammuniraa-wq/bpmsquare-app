import { NextResponse, NextRequest } from "next/server";
import { getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { isMissingSchema, loadTender } from "@/lib/tender/server";
import { openTenderDealRequest, PENDING_BIDS } from "@/lib/tender/dealAccess";
import { isOutcomeStage, parseOutcome } from "@/lib/tender/outcome";

// PATCH /api/opportunities/[id]/tender/outcome -- the facts of how a tender ended: the awarded value and date, who won and at what
// price, why we lost, a note. Only once the tender is Awarded, Lost or No-bid. For Lost, the reason and who won are required.
// The reason and the competitor are the deal's own columns (opportunities.loss_reason / competitor); the other four facts live on
// opportunity_tenders (migration 0225). Only the fields that belong to the tender's stage are taken.

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await openTenderDealRequest(id, true);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId, userId, opp, tender } = gate.req;
  if (!isOutcomeStage(opp.stage)) return NextResponse.json({ error: "The outcome is recorded once the tender is Awarded, Lost or No-bid" }, { status: 409 });

  const parsed = parseOutcome(opp.stage, await request.json().catch(() => ({})), { competitor: opp.competitor, loss_reason: opp.loss_reason, winning_bidder: tender.winning_bidder });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 422 });

  const now = new Date().toISOString();
  const label = `${opp.ref ?? ""} ${opp.title}`.trim();
  const user = await getAuthUser();
  const actor = { actorId: user?.id ?? userId, actorEmail: user?.email };

  if (Object.keys(parsed.tender).length > 0) {
    const { error } = await admin.from("opportunity_tenders").update({ ...parsed.tender, updated_at: now }).eq("opportunity_id", id).eq("tenant_id", tenantId);
    if (error) {
      if (isMissingSchema(error)) return NextResponse.json({ error: PENDING_BIDS }, { status: 503 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const changes = diffForLog("opportunity_tenders", tender as unknown as Record<string, unknown>, parsed.tender as Record<string, unknown>);
    if (changes.length > 0) await logChange(supabase, { tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: label, action: "update", ...actor, changes });
  }
  if (Object.keys(parsed.deal).length > 0) {
    const { error } = await admin.from("opportunities").update({ ...parsed.deal, updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const changes = diffForLog("opportunities", opp as unknown as Record<string, unknown>, parsed.deal as Record<string, unknown>);
    if (changes.length > 0) await logChange(supabase, { tenantId, objectType: "opportunities", objectId: id, objectLabel: label, action: "update", ...actor, changes });
  }

  const fresh = await loadTender(admin, tenantId, id);
  return NextResponse.json({
    ok: true,
    award_value: fresh?.award_value ?? null, winning_bidder: fresh?.winning_bidder ?? null, award_date: fresh?.award_date ?? null, outcome_note: fresh?.outcome_note ?? null,
  });
}

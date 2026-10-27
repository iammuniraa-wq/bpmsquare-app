import { NextResponse, NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { diffForLog, logChange } from "@/lib/changeLog";
import { loadActorNames } from "@/lib/actorNames";
import { probabilityFor, stageDef } from "@/lib/sales/opportunity";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { emitOpportunityStageChanged } from "@/lib/events/emitters";
import { DECISION_STAGE, NO_BID_STAGE, canDecide, outcomeMessage, parseAction, stageAfterApproval } from "@/lib/tender/approval";
import { loadApprovalById, loadApprovers } from "@/lib/tender/approvalServer";
import { dealLink, inboxNote, loadNotifyTenant, memberEmails, sendTenderMail } from "@/lib/tender/notify";
import { tenderStages } from "@/lib/tender/rules";
import { loadTender } from "@/lib/tender/server";

// PATCH /api/opportunities/[id]/tender/approval/[requestId]  { action: "approve" | "reject" | "cancel", comment? }
//   approve / reject : an approver chosen in Settings > Tenders (workspace admins by default). The proposer cannot decide
//                      their own proposal unless the workspace allows self-approval. Rejection needs a comment and returns
//                      the deal to Bid/No-bid. Approval records the decision on the tender (who approved and when) and, from Received
//                      or Bid/No-bid, moves the deal on by itself: go to Estimating, no-go to No-bid (the response says so).
//   cancel           : the proposer withdraws a proposal still waiting.
// The row is claimed with a compare-and-set on status = pending, so two people deciding at once cannot both win.

async function guard() {
  const ctx = await requireTenantUser();
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "gcc_tender"))) throw Object.assign(new Error("Not found"), { status: 404 });
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "pipeline"))) throw Object.assign(new Error("Pipeline isn't enabled for your workspace"), { status: 403 });
  return ctx;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  let supabase, tenantId, userId;
  try { ({ supabase, tenantId, userId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const { id, requestId } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = parseAction(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  const tender = opp ? await loadTender(admin, tenantId, id) : null;
  const req = opp && tender && /^[0-9a-f-]{36}$/i.test(requestId) ? await loadApprovalById(admin, tenantId, id, requestId) : null;
  if (!opp || !tender || !req) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.status !== "pending") return NextResponse.json({ error: "This proposal has already been decided" }, { status: 409 });

  const tenantRow = await getTenant();
  if (parsed.action === "cancel") {
    if (req.requested_by !== userId) return NextResponse.json({ error: "Only the person who proposed it can withdraw it" }, { status: 403 });
  } else {
    const { approvers, allowSelfApproval } = await loadApprovers(admin, tenantId, tenantRow?.config);
    if (!canDecide(userId, approvers, req.requested_by, allowSelfApproval)) {
      const own = req.requested_by === userId && approvers.includes(userId);
      return NextResponse.json({ error: own ? "You cannot approve your own proposal" : "You are not an approver for bid decisions" }, { status: 403 });
    }
  }

  const status = parsed.action === "approve" ? "approved" : parsed.action === "reject" ? "rejected" : "cancelled";
  const now = new Date().toISOString();
  const claimed = await admin.from("approval_requests")
    .update({ status, decided_by: userId, decided_at: now, decision_comment: parsed.comment })
    .eq("id", requestId).eq("tenant_id", tenantId).eq("status", "pending").select("id");
  if (claimed.error) return NextResponse.json({ error: claimed.error.message }, { status: 500 });
  if ((claimed.data ?? []).length === 0) return NextResponse.json({ error: "This proposal has already been decided" }, { status: 409 });

  const user = await getAuthUser();
  const label = `${opp.ref ?? ""} ${opp.title}`.trim();
  const word = req.proposed_value === "go" ? "Go" : "No-go";
  const base = { tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: label, actorId: user?.id, actorEmail: user?.email };

  let movedTo: string | null = null;
  let stageError: string | null = null;
  if (parsed.action === "approve") {
    const patch = { decision: req.proposed_value, decision_reason: req.reason, decided_by: userId, decided_at: now, updated_at: now };
    const { error } = await admin.from("opportunity_tenders").update(patch).eq("opportunity_id", id).eq("tenant_id", tenantId);
    if (error) {
      await admin.from("approval_requests").update({ status: "pending", decided_by: null, decided_at: null, decision_comment: null }).eq("id", requestId).eq("tenant_id", tenantId);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await logChange(supabase, {
      ...base, action: "update",
      changes: [{ field: "Bid decision approved", from: null, to: `${word}${parsed.comment ? `: ${parsed.comment}` : ""}` }, ...diffForLog("opportunity_tenders", tender as unknown as Record<string, unknown>, { decision: req.proposed_value, decision_reason: req.reason })],
    });
    // An approved decision moves the deal by itself, through the deal's own stage route (so the stage guard, the closing and outcome
    // rules, the change log and the events all run exactly as for a person moving it). A refusal never undoes the approval.
    const to = stageAfterApproval({ stage: opp.stage, outcome: opp.outcome, decision: req.proposed_value });
    if (to) {
      const { PATCH: movePatch } = await import("@/app/api/opportunities/[id]/route");
      const moveBody = to === NO_BID_STAGE ? { stage: to, outcome: "dropped", loss_reason: "other", loss_note: req.reason } : { stage: to, outcome: "open" };
      const moved = await movePatch(
        new NextRequest(new URL(`/api/opportunities/${id}`, "http://internal.invalid"), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(moveBody) }),
        { params: Promise.resolve({ id }) },
      );
      if (moved.ok) movedTo = to;
      else stageError = ((await moved.json().catch(() => ({}))) as { error?: string }).error ?? "The deal could not be moved";
    }
  } else if (parsed.action === "reject") {
    await logChange(supabase, { ...base, action: "update", changes: [{ field: "Bid decision rejected", from: word, to: parsed.comment }] });
    // Back to Bid/No-bid. A proposal is only possible from Received or Bid/No-bid, so this only ever moves Received forward.
    if (opp.stage !== DECISION_STAGE && opp.outcome === "open") {
      const stages = tenderStages();
      const probability = probabilityFor(stages, DECISION_STAGE, opp.probability_override);
      const { error } = await admin.from("opportunities").update({ stage: DECISION_STAGE, probability, updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
      if (!error) {
        await logChange(supabase, { ...base, objectType: "opportunities", action: "update", changes: diffForLog("opportunities", opp as unknown as Record<string, unknown>, { stage: DECISION_STAGE }) });
        await emitOpportunityStageChanged(tenantId, {
          opportunityId: id, ref: opp.ref, from: opp.stage, to: DECISION_STAGE, outcome: "open", amount: opp.amount, accountId: opp.account_id, contactId: opp.contact_id, stamp: now, actorId: user?.id,
        });
      }
    }
  } else {
    await logChange(supabase, { ...base, action: "update", changes: [{ field: "Bid decision proposal withdrawn", from: word, to: null }] });
  }

  // Tell the proposer how it went (e-mail + Nova inbox). A withdrawal tells no one; deciding your own proposal tells no one.
  if (parsed.action !== "cancel" && req.requested_by !== userId) {
    try {
      const tenant = await loadNotifyTenant(admin, tenantId);
      const to = await memberEmails(admin, tenantId, [req.requested_by]);
      const names = await loadActorNames(admin, tenantId, [userId]);
      if (tenant && to.length > 0) {
        const msg = outcomeMessage({ title: opp.title, decider: names.get(userId) ?? user?.email ?? "A manager", decision: req.proposed_value, approved: parsed.action === "approve", comment: parsed.comment, link: dealLink(tenant, id), movedTo: movedTo ? (stageDef(tenderStages(), movedTo)?.label ?? movedTo) : null });
        await inboxNote(admin, { tenantId, dealId: id, authorId: userId, authorEmail: user?.email ?? null, body: msg.comment, mentionEmails: to.map((t) => t.email) });
        await sendTenderMail(admin, tenant, { to: to.map((t) => t.email), subject: msg.subject, text: msg.text, dealId: id, dealLabel: label, actorId: userId, actorEmail: user?.email ?? null });
      }
    } catch (e) {
      console.error("[tender] approval outcome notification failed", (e as Error).message);
    }
  }
  return NextResponse.json({ ok: true, status, stage_moved: movedTo, stage_error: stageError });
}

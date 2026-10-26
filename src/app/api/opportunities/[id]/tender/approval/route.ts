import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";
import { loadActorNames } from "@/lib/actorNames";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { APPROVAL_KIND_TENDER_BID, APPROVAL_OBJECT_TENDER, decidersFor, parseProposal, proposalMessage, proposalProblem } from "@/lib/tender/approval";
import { buildApprovalView, loadApprovals, loadApprovers } from "@/lib/tender/approvalServer";
import { dealLink, inboxNote, loadNotifyTenant, memberEmails, sendTenderMail } from "@/lib/tender/notify";
import { loadTender } from "@/lib/tender/server";

// GET  /api/opportunities/[id]/tender/approval  -> what the Overview shows for the bid decision (pending proposal, the
//                                                   decision that stands, history, and whether this person may decide).
// POST /api/opportunities/[id]/tender/approval  { decision: "go" | "no_go", reason }  -> a team member PROPOSES the decision.
// A manager decides it on ./[requestId]. Who proposed and when come from the session and the server clock, never the body.

async function guard() {
  const ctx = await requireTenantUser();
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "gcc_tender"))) throw Object.assign(new Error("Not found"), { status: 404 });
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "pipeline"))) throw Object.assign(new Error("Pipeline isn't enabled for your workspace"), { status: 403 });
  return ctx;
}
const fail = (e: unknown) => {
  const err = e as { status?: number; message: string };
  return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
};

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let tenantId, userId;
  try { ({ tenantId, userId } = await guard()); } catch (e) { return fail(e); }
  const { id } = await params;
  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  const tender = opp ? await loadTender(admin, tenantId, id) : null;
  if (!opp || !tender) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const tenant = await getTenant();
  const view = await buildApprovalView(admin, { tenantId, userId, config: tenant?.config, deal: opp, tender, opportunityId: id });
  if (!view) return NextResponse.json({ error: "Approval needs a database update (migration 0221)" }, { status: 503 });
  return NextResponse.json(view);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try { ({ supabase, tenantId, userId } = await guard()); } catch (e) { return fail(e); }
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const parsed = parseProposal(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  const tender = opp ? await loadTender(admin, tenantId, id) : null;
  if (!opp || !tender) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { rows, pending } = await loadApprovals(admin, tenantId, id);
  if (pending) return NextResponse.json({ error: "Approval needs a database update (migration 0221). Ask your administrator to apply it" }, { status: 503 });
  const tenantRow = await getTenant();
  const { approvers, allowSelfApproval } = await loadApprovers(admin, tenantId, tenantRow?.config);
  const deciders = decidersFor(approvers, userId, allowSelfApproval);
  const problem = proposalProblem({ stage: opp.stage, outcome: opp.outcome, hasPending: rows.some((r) => r.status === "pending"), deciders });
  if (problem) return NextResponse.json({ error: problem }, { status: 409 });

  const { data: made, error } = await admin.from("approval_requests").insert({
    tenant_id: tenantId, object_type: APPROVAL_OBJECT_TENDER, object_id: id, kind: APPROVAL_KIND_TENDER_BID,
    proposed_value: parsed.decision, reason: parsed.reason, requested_by: userId, status: "pending",
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "A proposal is already waiting for approval" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const user = await getAuthUser();
  const label = `${opp.ref ?? ""} ${opp.title}`.trim();
  await logChange(supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: label, action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Bid decision proposed", from: null, to: `${parsed.decision === "go" ? "Go" : "No-go"}: ${parsed.reason}` }],
  });

  // Tell the approvers: an e-mail (resolveOutbound, email log) and an entry in their Nova inbox. Never fails the proposal.
  try {
    const tenant = await loadNotifyTenant(admin, tenantId);
    const names = await loadActorNames(admin, tenantId, [userId]);
    const to = await memberEmails(admin, tenantId, deciders);
    if (tenant && to.length > 0) {
      const msg = proposalMessage({ title: opp.title, proposer: names.get(userId) ?? user?.email ?? "A colleague", decision: parsed.decision, reason: parsed.reason, link: dealLink(tenant, id) });
      await inboxNote(admin, { tenantId, dealId: id, authorId: userId, authorEmail: user?.email ?? null, body: msg.comment, mentionEmails: to.map((t) => t.email) });
      await sendTenderMail(admin, tenant, { to: to.map((t) => t.email), subject: msg.subject, text: msg.text, dealId: id, dealLabel: label, actorId: userId, actorEmail: user?.email ?? null });
    }
  } catch (e) {
    console.error("[tender] approval notification failed", (e as Error).message);
  }
  return NextResponse.json({ id: (made as { id: string }).id }, { status: 201 });
}

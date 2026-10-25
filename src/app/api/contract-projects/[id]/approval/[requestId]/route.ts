import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { loadActorNames } from "@/lib/actorNames";
import { getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { loadApprovers } from "@/lib/tender/approvalServer";
import { loadNotifyTenant, memberEmails } from "@/lib/tender/notify";
import { canDecide, outcomeMessage, parseAction } from "@/lib/contractProjects/approval";
import { loadProjectApprovalById } from "@/lib/contractProjects/approvalServer";
import { projectInboxNote, projectLink, sendProjectMail } from "@/lib/contractProjects/notify";
import { loadProject, loadRevision, needsUpdate, openProjectRequest, UUID_RE } from "@/lib/contractProjects/server";

// PATCH /api/contract-projects/[id]/approval/[requestId]  { action: "approve" | "reject" | "cancel", comment? }
//   approve / reject : an approver chosen in Settings > Tenders (workspace admins by default). The person who asked cannot decide their
//                      own request unless the workspace allows self-approval. Rejecting needs a comment and returns the revision to draft.
//                      Approving locks the revision (it becomes the approved budget), supersedes the one it replaces, and makes the
//                      project active.
//   cancel           : the person who asked withdraws a request still waiting; the revision returns to draft.
// The request is claimed with a compare-and-set on status = pending, so two people deciding at once cannot both win. The request must
// belong to THIS project and workspace: a request id of another project matches nothing (404).

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const gate = await openProjectRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId, userId } = gate.req;
  const { id, requestId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseAction(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  const req = found.kind === "ok" && UUID_RE.test(requestId) ? await loadProjectApprovalById(admin, tenantId, id, requestId) : null;
  if (found.kind !== "ok" || !req) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const project = found.project;
  if (req.status !== "pending") return NextResponse.json({ error: "This request has already been decided" }, { status: 409 });
  const revision = await loadRevision(admin, tenantId, id, req.proposed_value);
  if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });

  const tenantRow = await getTenant();
  if (parsed.action === "cancel") {
    if (req.requested_by !== userId) return NextResponse.json({ error: "Only the person who asked can withdraw it" }, { status: 403 });
  } else {
    const { approvers, allowSelfApproval } = await loadApprovers(admin, tenantId, tenantRow?.config);
    if (!canDecide(userId, approvers, req.requested_by, allowSelfApproval)) {
      const own = req.requested_by === userId && approvers.includes(userId);
      return NextResponse.json({ error: own ? "You cannot approve your own request" : "You are not an approver for project budgets" }, { status: 403 });
    }
  }

  const status = parsed.action === "approve" ? "approved" : parsed.action === "reject" ? "rejected" : "cancelled";
  const now = new Date().toISOString();
  const claimed = await admin.from("approval_requests")
    .update({ status, decided_by: userId, decided_at: now, decision_comment: parsed.comment })
    .eq("id", requestId).eq("tenant_id", tenantId).eq("status", "pending").select("id");
  if (claimed.error) return NextResponse.json({ error: claimed.error.message }, { status: 500 });
  if ((claimed.data ?? []).length === 0) return NextResponse.json({ error: "This request has already been decided" }, { status: 409 });

  const undoClaim = () => admin.from("approval_requests").update({ status: "pending", decided_by: null, decided_at: null, decision_comment: null }).eq("id", requestId).eq("tenant_id", tenantId);
  const user = await getAuthUser();
  const label = `${project.ref ?? ""} ${project.name}`.trim();
  const what = revision.rev_no === 0 ? "Baseline" : `Revision ${revision.rev_no}`;
  const base = { tenantId, objectType: "contract_projects", objectId: id, objectLabel: label, actorId: user?.id, actorEmail: user?.email };

  if (parsed.action === "approve") {
    // The approved revision is unique per project: the old one is superseded first, and put back if the new one cannot be approved.
    const old = await admin.from("project_budget_revisions").update({ status: "superseded" }).eq("project_id", id).eq("tenant_id", tenantId).eq("status", "approved").neq("id", revision.id).select("id");
    if (old.error) { await undoClaim(); return NextResponse.json({ error: old.error.message }, { status: 500 }); }
    const approvedNow = await admin.from("project_budget_revisions")
      .update({ status: "approved", approved_by: userId, approved_at: now, locked_at: now })
      .eq("id", revision.id).eq("tenant_id", tenantId).eq("project_id", id).eq("status", "pending").select("id");
    if (approvedNow.error || (approvedNow.data ?? []).length === 0) {
      for (const o of (old.data ?? []) as { id: string }[]) await admin.from("project_budget_revisions").update({ status: "approved" }).eq("id", o.id).eq("tenant_id", tenantId);
      await undoClaim();
      return NextResponse.json({ error: approvedNow.error?.message ?? "This revision is no longer waiting for approval" }, { status: approvedNow.error ? 500 : 409 });
    }
    if (project.status !== "closed") await admin.from("contract_projects").update({ status: "active", updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
    await logChange(supabase, { ...base, action: "update", changes: [{ field: `${what} approved`, from: null, to: `${parsed.comment ? `${parsed.comment}. ` : ""}Budget ${revision.total} locked` }, { field: "Status", from: project.status, to: project.status === "closed" ? "closed" : "active" }] });
  } else {
    await admin.from("project_budget_revisions").update({ status: "draft" }).eq("id", revision.id).eq("tenant_id", tenantId).eq("project_id", id).eq("status", "pending");
    if (revision.rev_no === 0 && project.status === "baseline_pending") await admin.from("contract_projects").update({ status: "draft", updated_at: now }).eq("id", id).eq("tenant_id", tenantId);
    await logChange(supabase, { ...base, action: "update", changes: [{ field: parsed.action === "reject" ? `${what} rejected` : `${what} request withdrawn`, from: null, to: parsed.comment }] });
  }

  // Tell the person who asked how it went. A withdrawal tells no one; deciding your own request tells no one.
  if (parsed.action !== "cancel" && req.requested_by !== userId) {
    try {
      const tenant = await loadNotifyTenant(admin, tenantId);
      const to = await memberEmails(admin, tenantId, [req.requested_by]);
      const names = await loadActorNames(admin, tenantId, [userId]);
      if (tenant && to.length > 0) {
        const msg = outcomeMessage({ project: project.name, ref: project.ref, decider: names.get(userId) ?? user?.email ?? "A manager", revNo: revision.rev_no, approved: parsed.action === "approve", comment: parsed.comment, link: projectLink(tenant, id) });
        await projectInboxNote(admin, { tenantId, projectId: id, authorId: userId, authorEmail: user?.email ?? null, body: msg.comment, mentionEmails: to.map((t) => t.email) });
        await sendProjectMail(admin, tenant, { to: to.map((t) => t.email), subject: msg.subject, text: msg.text, projectId: id, projectLabel: label, actorId: userId, actorEmail: user?.email ?? null });
      }
    } catch (e) {
      console.error("[contract-projects] approval outcome notification failed", (e as Error).message);
    }
  }
  return NextResponse.json({ ok: true, status });
}

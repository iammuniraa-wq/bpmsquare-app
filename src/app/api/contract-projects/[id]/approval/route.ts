import { NextResponse, type NextRequest } from "next/server";
import { logChange } from "@/lib/changeLog";
import { loadActorNames } from "@/lib/actorNames";
import { getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { loadApprovers } from "@/lib/tender/approvalServer";
import { loadNotifyTenant, memberEmails } from "@/lib/tender/notify";
import { askMessage, askProblem, decidersFor, PROJECT_APPROVAL_KIND, PROJECT_APPROVAL_OBJECT, requestReason } from "@/lib/contractProjects/approval";
import { budgetTotals } from "@/lib/contractProjects/budget";
import { loadProjectApprovals } from "@/lib/contractProjects/approvalServer";
import { projectInboxNote, projectLink, sendProjectMail } from "@/lib/contractProjects/notify";
import { currentRevision, loadLines, loadMasters, loadProject, loadRevision, loadRevisions, needsUpdate, openProjectRequest, UUID_RE, APPROVAL_BUNDLE } from "@/lib/contractProjects/server";

// POST /api/contract-projects/[id]/approval  { revision_id? }
//   Asks the approvers to approve a DRAFT revision (default: the one being worked on). The revision becomes `pending` and locked against
//   edits until it is decided; for the baseline the project becomes `baseline_pending`. Who asked and when are the session's and the
//   server clock's. Refused (409) when the revision has no lines or a line has no resource type, when a later revision has no reason,
//   or when nobody else could approve it. Approval rows are the same table as the bid decision (kind project_baseline); the people who
//   may decide are the tender approvers chosen in Settings > Tenders (workspace admins by default).
//   503 while approval_requests (migration 0221) is pending. Decided on ./[requestId].

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { admin, supabase, tenantId, userId } = gate.req;
  const { id } = await params;
  const found = await loadProject(admin, tenantId, id);
  if (found.kind === "pending") return NextResponse.json({ error: needsUpdate().error, needsDatabaseUpdate: true }, { status: 503 });
  if (found.kind !== "ok") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const project = found.project;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const { rows: revisions } = await loadRevisions(admin, tenantId, id);
  const wanted = typeof body.revision_id === "string" && body.revision_id ? body.revision_id : null;
  if (wanted && !UUID_RE.test(wanted)) return NextResponse.json({ error: "Revision not found" }, { status: 404 });
  const revision = wanted ? await loadRevision(admin, tenantId, id, wanted) : currentRevision(revisions);
  if (!revision) return NextResponse.json({ error: "Revision not found" }, { status: 404 });

  const { rows: approvals, pending: approvalMissing } = await loadProjectApprovals(admin, tenantId, id);
  if (approvalMissing) return NextResponse.json({ error: "Approval needs a database update (migration 0221). Ask your administrator to apply it", needsDatabaseUpdate: true, bundle: APPROVAL_BUNDLE }, { status: 503 });

  const lines = await loadLines(admin, tenantId, revision.id);
  const totals = budgetTotals(lines);
  const tenantRow = await getTenant();
  const { approvers, allowSelfApproval } = await loadApprovers(admin, tenantId, tenantRow?.config);
  const deciders = decidersFor(approvers, userId, allowSelfApproval);
  const problem = approvals.some((a) => a.status === "pending")
    ? "A budget is already waiting for approval"
    : askProblem({ revision, lineCount: lines.length, linesWithoutResource: totals.noResourceCount, deciders, projectClosed: project.status === "closed" });
  if (problem) return NextResponse.json({ error: problem }, { status: 409 });

  const justification = revision.justification_code ? (await loadMasters(admin, tenantId, "justification")).find((m) => m.code === revision.justification_code)?.name ?? null : null;
  const reason = requestReason(revision, justification, totals.total, project.currency);

  const made = await admin.from("approval_requests").insert({
    tenant_id: tenantId, object_type: PROJECT_APPROVAL_OBJECT, object_id: id, kind: PROJECT_APPROVAL_KIND,
    proposed_value: revision.id, reason, requested_by: userId, status: "pending",
  }).select("id").single();
  if (made.error || !made.data) {
    if (made.error?.code === "23505") return NextResponse.json({ error: "A budget is already waiting for approval" }, { status: 409 });
    return NextResponse.json({ error: made.error?.message ?? "Could not ask for approval" }, { status: 500 });
  }
  const requestId = (made.data as { id: string }).id;

  // The revision locks now: compare-and-set on draft, so an edit that slipped in between cannot be approved unseen.
  const locked = await admin.from("project_budget_revisions").update({ status: "pending", total: totals.total }).eq("id", revision.id).eq("tenant_id", tenantId).eq("project_id", id).eq("status", "draft").select("id");
  if (locked.error || (locked.data ?? []).length === 0) {
    await admin.from("approval_requests").delete().eq("id", requestId).eq("tenant_id", tenantId);
    return NextResponse.json({ error: "This revision changed while you were asking. Reload and try again" }, { status: 409 });
  }
  if (revision.rev_no === 0) await admin.from("contract_projects").update({ status: "baseline_pending", updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", tenantId);

  const user = await getAuthUser();
  const label = `${project.ref ?? ""} ${project.name}`.trim();
  await logChange(supabase, {
    tenantId, objectType: "contract_projects", objectId: id, objectLabel: label, action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: revision.rev_no === 0 ? "Baseline sent for approval" : `Revision ${revision.rev_no} sent for approval`, from: null, to: reason }],
  });

  try {
    const tenant = await loadNotifyTenant(admin, tenantId);
    const names = await loadActorNames(admin, tenantId, [userId]);
    const to = await memberEmails(admin, tenantId, deciders);
    if (tenant && to.length > 0) {
      const msg = askMessage({ project: project.name, ref: project.ref, proposer: names.get(userId) ?? user?.email ?? "A colleague", revNo: revision.rev_no, reason, link: projectLink(tenant, id) });
      await projectInboxNote(admin, { tenantId, projectId: id, authorId: userId, authorEmail: user?.email ?? null, body: msg.comment, mentionEmails: to.map((t) => t.email) });
      await sendProjectMail(admin, tenant, { to: to.map((t) => t.email), subject: msg.subject, text: msg.text, projectId: id, projectLabel: label, actorId: userId, actorEmail: user?.email ?? null });
    }
  } catch (e) {
    console.error("[contract-projects] approval notification failed", (e as Error).message);
  }
  return NextResponse.json({ id: requestId }, { status: 201 });
}

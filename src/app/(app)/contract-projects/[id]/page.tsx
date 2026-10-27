import { notFound } from "next/navigation";
import { getTenant, requireFeature } from "@/lib/tenant";
import { canEditWorkcenter, requireWorkcenterView, resolvePermissions } from "@/lib/permissions";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import StatusPill from "@/components/ui/StatusPill";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordActivity from "@/components/page/RecordActivity";
import ProjectOverview from "@/components/contractProjects/ProjectOverview";
import BudgetGrid from "@/components/contractProjects/BudgetGrid";
import RevisionsPanel from "@/components/contractProjects/RevisionsPanel";
import HandoverPanel from "@/components/contractProjects/HandoverPanel";
import ProjectMenu from "@/components/contractProjects/ProjectMenu";
import { InvoicingSection, VariationsSection } from "@/components/contractProjects/AfterAwardSections";
import ProjectDetailsForm from "@/components/contractProjects/ProjectDetailsForm";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";
import { loadProject, UUID_RE, type ProjectCtx } from "@/lib/contractProjects/server";
import { buildProjectView } from "@/lib/contractProjects/view";
import ProjectKpiStrip from "@/components/contractProjects/ProjectKpiStrip";
import { projectTone } from "@/lib/contractProjects/format";
import { PROJECT_STATUS_LABEL } from "@/lib/contractProjects/types";

/** The record page of a contract project: Overview (the visual summary), Budget, Variations, Invoicing, Revisions, Handover, Activity. */
export default async function ContractProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; revision?: string }> }) {
  await requireWorkcenterView("contract_projects");
  await requireFeature("contract_projects");
  const { id } = await params;
  const { tab, revision } = await searchParams;
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const tenant = await getTenant();
  if (tenant?.features?.gcc_tender !== true) notFound();
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  const req: ProjectCtx = { admin: createAdminSupabase(), supabase, tenantId, userId, role, canEdit: canEditWorkcenter(perms, "contract_projects") };
  const found = await loadProject(req.admin, tenantId, id);
  if (found.kind === "pending") {
    return <div role="alert" style={{ fontSize: 13, color: "var(--amberink)" }}>Contract projects need a database update (migration 0226). Ask your administrator to apply it.</div>;
  }
  if (found.kind !== "ok") notFound();
  const view = await buildProjectView(req, found.project, { revisionId: revision && UUID_RE.test(revision) ? revision : null });
  const p = view.project;
  const rev = view.revision;
  const revLabel = rev ? (rev.rev_no === 0 ? "Baseline" : `Revision ${rev.rev_no}`) : null;
  const members = view.canEdit && p.status !== "closed" ? await listMembersForPicker(req.admin, tenantId) : [];
  const deletable =p.status === "draft" && view.revisions.every((r) => r.status === "draft");

  return (
    <ObjectRecordPage
      backHref={ROUTES.contractProjects}
      backLabel="All contract projects"
      title={p.name}
      reference={p.ref}
      meta={view.account_name ?? undefined}
      status={<StatusPill label={PROJECT_STATUS_LABEL[p.status]} tone={projectTone(p.status)} />}
      menu={<ProjectMenu projectId={p.id} status={p.status} canEdit={view.canEdit} deletable={deletable} />}
      externalLine={<ProjectKpiStrip view={view} />}
      basePath={ROUTES.contractProject(p.id)}
      activeTab={tab}
      tabs={[
        {
          id: "overview", label: "Overview",
          content: <ProjectOverview view={view} editor={view.canEdit && p.status !== "closed" ? <ProjectDetailsForm projectId={p.id} initial={{ name: p.name, contract_value: p.contract_value, planned_start: p.planned_start, planned_end: p.planned_end, manager_id: p.manager_id }} members={members} /> : undefined} />,
        },
        {
          id: "budget", label: "Budget", count: view.totals.lineCount,
          content: rev ? (
            <BudgetGrid
              key={rev.id} projectId={p.id} revision={rev} revisions={view.revisions} lines={view.lines} resources={view.resources}
              canEdit={view.canEdit} projectClosed={p.status === "closed"} currency={p.currency}
            />
          ) : <div style={{ fontSize: 13, color: "var(--hint)" }}>There is no budget yet.</div>,
        },
        { id: "variations", label: "Variations", content: <VariationsSection req={req} project={p} /> },
        { id: "invoicing", label: "Invoicing", content: <InvoicingSection req={req} project={p} /> },
        { id: "revisions", label: "Revisions", count: view.revisions.length, content: <RevisionsPanel view={view} /> },
        { id: "handover", label: "Handover", content: <HandoverPanel projectId={p.id} revisionId={rev?.id ?? null} revLabel={revLabel} hasBudget={!!rev && view.lines.length > 0} /> },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="contract_projects" objectId={p.id} isAdmin={role === "admin"} /> },
      ]}
    />
  );
}

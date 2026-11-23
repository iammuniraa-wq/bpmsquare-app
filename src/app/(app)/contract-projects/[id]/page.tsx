import { notFound } from "next/navigation";
import { getTenant, requireFeature } from "@/lib/tenant";
import { canEditWorkcenter, canViewWorkcenter, requireWorkcenterView, resolvePermissions } from "@/lib/permissions";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import StatusPill from "@/components/ui/StatusPill";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordActivity from "@/components/page/RecordActivity";
import ProjectOverview from "@/components/contractProjects/ProjectOverview";
import BudgetGrid from "@/components/contractProjects/BudgetGrid";
import WbsTab from "@/components/contractProjects/WbsTab";
import RevisionsPanel from "@/components/contractProjects/RevisionsPanel";
import HandoverPanel from "@/components/contractProjects/HandoverPanel";
import ProjectMenu from "@/components/contractProjects/ProjectMenu";
import { InvoicingSection, VariationsSection } from "@/components/contractProjects/AfterAwardSections";
import ProjectDetailsForm from "@/components/contractProjects/ProjectDetailsForm";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";
import { loadProject, UUID_RE, type ProjectCtx } from "@/lib/contractProjects/server";
import { buildProjectView } from "@/lib/contractProjects/view";
import { estimateFillAvailable, estimateOfProject, fillAvailable } from "@/lib/contractProjects/allocationServer";
import { loadEmployeeChoices } from "@/lib/contractProjects/workPackagesServer";
import ProjectKpiStrip from "@/components/contractProjects/ProjectKpiStrip";
import ProjectPathBar from "@/components/contractProjects/ProjectPathBar";
import { projectTone } from "@/lib/contractProjects/format";
import { PROJECT_STATUS_LABEL, isTenderProject, projectSourceNote, sourceTypeOf } from "@/lib/contractProjects/types";
import BuyoutSection from "@/components/contractProjects/buyout/BuyoutSection";
import { buyoutVisible } from "@/components/contractProjects/buyout/rules";
import { wbsSummary } from "@/lib/contractProjects/wbsSummary";
import { canSeeProjectFinance } from "@/lib/projectFinance/access";
import { getProjectFinance, resolveFinanceAccess } from "@/lib/projectFinance/server";
import ForecastSection from "@/components/projectFinance/ForecastSection";
import HealthCard from "@/components/projectFinance/HealthCard";

/** The record page of a contract project: Overview (the visual summary), Budget, WBS, Buy-out (tender-made projects), Variations, Invoicing, Revisions, Handover, Activity. */
export default async function ContractProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; revision?: string }> }) {
  await requireWorkcenterView("contract_projects");
  await requireFeature("contract_projects");
  const { id } = await params;
  const { tab, revision } = await searchParams;
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const tenant = await getTenant();
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  const req: ProjectCtx = { admin: createAdminSupabase(), supabase, tenantId, userId, role, canEdit: canEditWorkcenter(perms, "contract_projects") };
  const found = await loadProject(req.admin, tenantId, id);
  if (found.kind === "pending") {
    return <div role="alert" style={{ fontSize: 13, color: "var(--amberink)" }}>Contract projects need a database update (migration 0226). Ask your administrator to apply it.</div>;
  }
  if (found.kind !== "ok") notFound();
  // The WBS and the employees who can own an item are read only where they are drawn: Overview (its counts), Budget and WBS.
  const onBudgetTab = tab === "budget";
  const onWbsTab = tab === "wbs";
  const withPackages = onBudgetTab || onWbsTab || !tab || tab === "overview";
  const view = await buildProjectView(req, found.project, { revisionId: revision && UUID_RE.test(revision) ? revision : null, withPackages });
  const employees = (onBudgetTab || onWbsTab) && view.canEdit ? await loadEmployeeChoices(req.admin, tenantId) : [];
  const p = view.project;
  const rev = view.revision;
  const revLabel = rev ? (rev.rev_no === 0 ? "Baseline" : `Revision ${rev.rev_no}`) : null;
  const members = view.canEdit && p.status !== "closed" ? await listMembersForPicker(req.admin, tenantId) : [];
  const buyoutOn = buyoutVisible(p, tenant?.features);
  const fromEstimate = estimateFillAvailable(p, !!(await estimateOfProject(req.admin, tenantId, p)));
  const deletable =p.status === "draft" && view.revisions.every((r) => r.status === "draft");
  // A project made from a tender goes back to that tender, and says which bid and which BOQ file it came from, in the header.
  const origin = view.origin;
  // Cost and margin (feature project_dashboards): the access is decided here, where the data is made. A caller who may not see it gets no tab,
  // no card and no figure in the page.
  const financeAccess = tenant?.features?.project_dashboards === true
    ? await resolveFinanceAccess({ supabase, tenantId, userId, role, features: tenant.features, config: tenant.config })
    : null;
  const financeVisible = !!financeAccess && canSeeProjectFinance(financeAccess.caller, p, userId);
  if (financeAccess?.caller.visibility === "granted" && !financeVisible) view.hideMargin = true;
  const health = financeAccess && financeVisible && (!tab || tab === "overview")
    ? await getProjectFinance({ admin: req.admin, tenantId, userId, access: financeAccess, features: tenant?.features, project: p })
    : null;
  // What the WBS holds, one line: "WBS 6 items · 14 lines · 2 unassigned" (a project made from a tender took it over).
  const wbsLine = view.packages.length > 0 ? `WBS ${wbsSummary(view)}` : null;
  const qo = view.quoteOrigin;
  const sourceType = sourceTypeOf(p);
  // A quote project goes back to the quote it was made from (when the caller may open it), a tender project to its tender, a project by hand to the list.
  const features = tenant?.features;
  const links = {
    quote: !!qo && (qo.type === "standard_quote" ? features?.standard_quotes === true && canViewWorkcenter(perms, "standard_quotes") : features?.quotations === true && canViewWorkcenter(perms, "quotations")),
    estimate: features?.estimator === true && canViewWorkcenter(perms, "estimates"),
    deal: features?.pipeline === true && canViewWorkcenter(perms, "pipeline"),
  };
  const back = sourceType === "tender" && view.source ? { href: ROUTES.pipelineDetail(view.source.id), label: `Tender ${view.source.ref ?? view.source.title}` }
    : qo && links.quote ? { href: qo.type === "standard_quote" ? ROUTES.standardQuote(qo.id) : ROUTES.quotation(qo.id), label: `${qo.type === "standard_quote" ? "Standard quote" : "Quotation"} ${qo.ref ?? ""}`.trim() }
    : { href: ROUTES.contractProjects, label: "All contract projects" };
  const originMeta = [view.account_name, qo ? projectSourceNote(sourceType, qo.ref) : null, origin?.bid ? `from bid v${origin.bid.version_no}` : null, origin?.boq?.file_name, wbsLine].filter(Boolean).join(" · ");

  return (
    <ObjectRecordPage
      backHref={back.href}
      backLabel={back.label}
      title={p.name}
      reference={p.ref}
      meta={originMeta || undefined}
      status={<StatusPill label={PROJECT_STATUS_LABEL[p.status]} tone={projectTone(p.status)} />}
      menu={<ProjectMenu projectId={p.id} status={p.status} canEdit={view.canEdit} deletable={deletable} />}
      externalLine={<><ProjectPathBar path={view.path} /><ProjectKpiStrip view={view} buyoutOn={buyoutOn} /></>}
      basePath={ROUTES.contractProject(p.id)}
      activeTab={tab}
      tabs={[
        {
          id: "overview", label: "Overview",
          content: <ProjectOverview view={view} buyoutOn={buyoutOn} originLinks={links} health={health ? <HealthCard finance={health.finance} isAdmin={role === "admin"} floor={financeAccess?.settings.marginFloor ?? null} forecastTab /> : undefined} editor={view.canEdit && p.status !== "closed" ? <ProjectDetailsForm projectId={p.id} initial={{ name: p.name, contract_value: p.contract_value, planned_start: p.planned_start, planned_end: p.planned_end, manager_id: p.manager_id }} members={members} /> : undefined} />,
        },
        {
          id: "budget", label: "Budget", count: view.totals.lineCount,
          content: rev ? (
            <BudgetGrid
              key={rev.id} projectId={p.id} revision={rev} revisions={view.revisions} lines={view.lines} resources={view.resources}
              canEdit={view.canEdit} projectClosed={p.status === "closed"} currency={p.currency} buyoutOn={buyoutOn}
              contractValue={p.contract_value} valueNote={projectSourceNote(sourceType, qo?.ref)} marginFloor={view.marginFloor} basis={p.allocation_basis} allocation={view.allocation} packages={view.packages}
              packagesPending={view.packagesPending} employees={employees} fillAvailable={fillAvailable(p, view.lines)} estimateFillAvailable={fromEstimate} approval={view.approval}
            />
          ) : <div style={{ fontSize: 13, color: "var(--hint)" }}>There is no budget yet.</div>,
        },
        {
          id: "wbs", label: "WBS", count: view.packages.length || undefined,
          content: rev ? (
            <WbsTab
              projectId={p.id} basis={p.allocation_basis} revisionStatus={rev.status} projectClosed={p.status === "closed"} packages={view.packages} rows={view.allocation.wbsRows}
              unassigned={view.allocation.unassigned} lines={view.lines} employees={employees} currency={p.currency} canEdit={view.canEdit} pending={view.packagesPending}
              treePending={view.packagesTreePending} fromTender={isTenderProject(p)} buyoutOn={buyoutOn}
            />
          ) : <div style={{ fontSize: 13, color: "var(--hint)" }}>There is no budget yet, so there are no lines to group.</div>,
        },
        ...(buyoutOn ? [{ id: "buyout", label: "Buy-out", content: <BuyoutSection projectId={p.id} currency={p.currency} canEdit={view.canEdit && p.status !== "closed"} /> }] : []),
        { id: "variations", label: "Client changes", content: <VariationsSection req={req} project={p} /> },
        { id: "invoicing", label: "Client billing", content: <InvoicingSection req={req} project={p} /> },
        ...(financeVisible ? [{ id: "forecast", label: "Forecast", content: <ForecastSection req={req} project={p} /> }] : []),
        { id: "revisions", label: "Revisions", count: view.revisions.length, content: <RevisionsPanel view={view} /> },
        { id: "handover", label: "ERP handover", content: <HandoverPanel projectId={p.id} revisionId={rev?.id ?? null} revLabel={revLabel} hasBudget={!!rev && view.lines.length > 0} buyoutOn={buyoutOn} /> },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="contract_projects" objectId={p.id} isAdmin={role === "admin"} /> },
      ]}
    />
  );
}

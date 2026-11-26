import { notFound } from "next/navigation";
import { requireSitePage } from "@/lib/site/pageGuard";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import StatusPill from "@/components/ui/StatusPill";
import ObjectRecordPage from "@/components/page/ObjectRecordPage";
import RecordActivity from "@/components/page/RecordActivity";
import ObjectSections from "@/components/fields/ObjectSections";
import { anyProject, loadCategories, loadCostLineChoices, loadFiles, openSiteRequest } from "@/lib/site/server";
import { canSeeExpense, decorate, isDeciderOn, loadExpense, loadViewerScope, seesBudget } from "@/lib/site/expensesServer";
import { expenseStanding } from "@/lib/site/standing";
import { canCancelExpense, canDecideExpense, projectAmount } from "@/lib/site/expenseRules";
import { ERP_STATE_LABEL, EXPENSE_FLAG_LABEL, EXPENSE_STATUS_LABEL, PAID_BY_LABEL, type ExpenseStatus } from "@/lib/site/types";
import { fmtMoney } from "@/lib/site/clientHelpers";
import ExpenseActions from "@/components/site/ExpenseActions";
import ResubmitPanel from "@/components/site/ResubmitPanel";
import LineStandingBar from "@/components/site/LineStandingBar";
import EvidenceGrid from "@/components/site/EvidenceGrid";
import { Banner } from "@/components/site/siteUi";

const tone = (s: ExpenseStatus) => (s === "approved" ? "green" : s === "rejected" ? "red" : s === "cancelled" ? "blue" : "amber") as "green" | "red" | "blue" | "amber";

/** A site expense: what it is, its warnings, the budget line bar for the people who manage the money, the evidence, and the history. */
export default async function SiteExpensePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireSitePage("site_expenses");
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) notFound();
  const req = gate.req;
  const { id } = await params;
  const { tab } = await searchParams;
  const found = await loadExpense(req.admin, req.tenantId, id);
  if (found === "pending") return <div role="alert" style={{ fontSize: 13, color: "var(--amberink)" }}>Site expenses need a database update (migration 0258). Ask your administrator to apply it.</div>;
  const scope = await loadViewerScope(req);
  if (!found || !canSeeExpense(scope, found)) notFound();
  const [row] = await decorate(req, [found]);
  const project = await anyProject(req.admin, req.tenantId, found.project_id);
  if (!project) notFound();
  const mine = found.submitted_by === req.userId;
  const decider = isDeciderOn(scope, found.project_id);
  const budgetOk = seesBudget(scope, found.project_id);
  const category = (await loadCategories(req.admin, req.tenantId)).rows;
  const catLimit = category.find((x) => x.id === found.category_id)?.limit_amount ?? null;
  const decide = canDecideExpense({
    actorId: req.userId, actorIsAdmin: scope.isAdmin, submitterId: found.submitted_by, managerId: project.manager_id, costApprovers: scope.costApprovers,
    allowSelfApproval: scope.allowSelfApproval, amountInProject: projectAmount(found, project.currency), categoryLimit: catLimit, config: req.config,
  });
  const cancel = canCancelExpense({ status: found.status, erpState: found.erp_state, actorId: req.userId, submitterId: found.submitted_by, isDecider: decider });
  const [standing, files, lines] = await Promise.all([
    budgetOk ? expenseStanding(req.admin, req.tenantId, project, found) : Promise.resolve(null),
    loadFiles(req.admin, req.tenantId, "site_expense", id),
    (decider && !found.line_key) || (mine && found.status === "rejected") ? loadCostLineChoices(req.admin, req.tenantId, project.id) : Promise.resolve([]),
  ]);
  const linePick = lines.map((l) => ({ line_key: l.line_key, description: l.description }));

  const details = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {found.status === "rejected" && !mine && <Banner tone="warn">Returned: {found.reject_reason}</Banner>}
      {found.status === "cancelled" && found.cancel_reason && <Banner tone="info">Cancelled: {found.cancel_reason}</Banner>}
      {found.flags.length > 0 && <Banner tone="warn">{found.flags.map((f) => EXPENSE_FLAG_LABEL[f]).join(" · ")}</Banner>}
      {found.document_state === "invoice_to_follow" && <Banner tone="info">Invoice to follow. The receipt is not attached yet.</Banner>}
      {found.ai_read && (found.ai_read as { state?: string }).state === "later" && <Banner tone="info">Read later: this was captured offline. Check the figures against the photo.</Banner>}
      {standing && <LineStandingBar standing={standing} />}
      {mine && found.status === "rejected" && (
        <ResubmitPanel id={id} reason={found.reject_reason} categories={category.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name }))} lines={linePick}
          initial={{ category_id: found.category_id, line_key: found.line_key, expense_date: found.expense_date, amount: found.amount, vendor_text: found.vendor_text, note: found.note }} />
      )}
      <ObjectSections objectType="site_expense" record={row as unknown as Record<string, unknown>} patchUrl={`/api/site-expenses/${id}`} />
    </div>
  );

  return (
    <ObjectRecordPage
      backHref={ROUTES.siteExpenses}
      backLabel="All site expenses"
      title={found.vendor_text ?? row.category_name ?? "Site expense"}
      reference={found.ref}
      meta={`${project.ref ? `${project.ref} · ` : ""}${project.name}`}
      status={<StatusPill label={EXPENSE_STATUS_LABEL[found.status]} tone={tone(found.status)} />}
      primaryAction={
        <ExpenseActions id={id} status={found.status} canDecide={decide.ok} canCancel={cancel.ok} projectCurrency={project.currency} currency={found.currency} hasLine={!!found.line_key} lines={linePick} />
      }
      facts={[
        { label: "Amount", value: fmtMoney(found.amount, found.currency) },
        { label: "Date", value: found.expense_date },
        { label: "Category", value: row.category_name ?? "—" },
        { label: "Entered by", value: row.submitted_by_name ?? "—" },
      ]}
      externalLine={<span style={{ fontSize: 12, color: c.hint }}>{PAID_BY_LABEL[found.paid_by]} · ERP: {ERP_STATE_LABEL[found.erp_state]}{found.erp_ref ? ` (${found.erp_ref})` : ""}</span>}
      basePath={ROUTES.siteExpense(id)}
      activeTab={tab}
      tabs={[
        { id: "details", label: "Details", content: details },
        { id: "evidence", label: "Evidence", count: files.length, content: <EvidenceGrid files={files} empty="No photo is attached. The invoice is to follow." /> },
        { id: "activity", label: "Activity", content: <RecordActivity objectType="site_expenses" objectId={id} isAdmin={req.role === "admin"} /> },
      ]}
    />
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { canSeeExpense, decorate, loadExpense, loadFiles, loadViewerScope, patchExpense, seesBudget } from "@/lib/site/expensesServer";
import { expenseStanding } from "@/lib/site/standing";
import { failure, needsUpdate, openSiteRequest, anyProject } from "@/lib/site/server";

// GET   /api/site-expenses/[id]  -> { expense, files, standing } standing (the budget line bar) only for the people who manage the money.
// PATCH /api/site-expenses/[id]  the submitter corrects a returned expense and sends it again, or sets custom fields (cf_ keys). Allowlisted.
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const { id } = await params;
  const e = await loadExpense(gate.req.admin, gate.req.tenantId, id);
  if (e === "pending") return failure(needsUpdate("site_expenses"));
  const scope = await loadViewerScope(gate.req);
  if (!e || !canSeeExpense(scope, e)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [[row], files, project] = await Promise.all([decorate(gate.req, [e]), loadFiles(gate.req.admin, gate.req.tenantId, "site_expense", id), anyProject(gate.req.admin, gate.req.tenantId, e.project_id)]);
  const standing = seesBudget(scope, e.project_id) && project ? await expenseStanding(gate.req.admin, gate.req.tenantId, project, e) : null;
  return NextResponse.json({ expense: row, files, standing, can_see_budget: seesBudget(scope, e.project_id) });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await patchExpense(gate.req, id, body);
  return NextResponse.json(r.body, { status: r.status });
}

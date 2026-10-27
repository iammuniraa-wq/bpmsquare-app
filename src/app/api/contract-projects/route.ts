import { NextResponse, type NextRequest } from "next/server";
import { cleanCurrency, cleanDate, cleanMoney, cleanName, createProject, loadTenderSource, projectNameFromDeal } from "@/lib/contractProjects/create";
import { listProjects } from "@/lib/contractProjects/list";
import { openProjectRequest } from "@/lib/contractProjects/server";
import { getTenant } from "@/lib/tenant";
import { resolveCurrency } from "@/lib/currency";

// Contract projects (docs/design/gcc-tender-deals.md section 15, migration 0226). Behind the platform-admin flag `contract_projects`
// (and gcc_tender): a workspace without them gets a 404 and nothing is read.
//
// GET  /api/contract-projects?status=&q=&sort=&dir=&page=&page_size=
//        -> { rows: [{ id, ref, name, status, account_id, account_name, contract_value, currency, budget_total, budget_state,
//                      margin_pct, planned_end, updated_at }], total, counts, page, page_size, pages, needsDatabaseUpdate? }
//      Header fields and totals only; the budget lines are on /api/contract-projects/[id]/budget.
// POST /api/contract-projects
//        { opportunity_id }                                  from an AWARDED tender of this workspace: one project per tender (409 otherwise)
//        { name, account_id?, contract_value?, currency?, planned_start?, planned_end?, manager_id? }   by hand
//      Every foreign id is verified against this workspace. -> 201 { id, ref, revision_id, estimated?, unmapped_codes?, skipped? }

export async function GET(request: NextRequest) {
  const gate = await openProjectRequest();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sp = new URL(request.url).searchParams;
  const out = await listProjects(gate.req.admin, gate.req.tenantId, {
    status: sp.get("status"), q: sp.get("q"), sort: sp.get("sort"), dir: sp.get("dir"),
    page: Number(sp.get("page")) || 1, pageSize: Number(sp.get("page_size")) || 25,
  });
  return NextResponse.json({
    rows: out.rows, total: out.total, counts: out.counts, page: out.page, page_size: out.pageSize, pages: Math.max(1, Math.ceil(out.total / out.pageSize)),
    ...(out.pending ? { needsDatabaseUpdate: true } : {}),
  });
}

export async function POST(request: NextRequest) {
  const gate = await openProjectRequest({ write: true });
  if (!gate.ok) return NextResponse.json({ error: gate.error, ...(gate.extra ?? {}) }, { status: gate.status });
  const { req } = gate;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  if (typeof body.opportunity_id === "string" && body.opportunity_id) {
    const src = await loadTenderSource(req.admin, req.tenantId, body.opportunity_id);
    if (!src.ok) return NextResponse.json({ error: src.error }, { status: src.status });
    const s = src.source;
    const made = await createProject(req, {
      name: cleanName(body.name) ?? projectNameFromDeal(s.title), account_id: s.accountId, source_opportunity_id: body.opportunity_id,
      contract_value: s.contractValue, currency: s.currency, planned_start: null, planned_end: null, manager_id: null, lines: s.lines, budget_note: s.budgetNote,
    });
    if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
    return NextResponse.json(
      { id: made.project.id, ref: made.project.ref, revision_id: made.revisionId, estimated: s.estimated, unmapped_codes: s.unmappedCodes, skipped: s.skipped, from_estimate: s.fromEstimate, estimate_warnings: s.estimateWarnings, cost_source: s.costSource.kind === "bid_version" ? `bid_version_${s.costSource.version_no}` : "boq", budget_note: s.budgetNote },
      { status: 201 },
    );
  }

  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: "Give the project a name" }, { status: 400 });
  const value = body.contract_value === undefined || body.contract_value === null || body.contract_value === "" ? 0 : cleanMoney(body.contract_value);
  if (value === null) return NextResponse.json({ error: "Contract value must be a number of 0 or more" }, { status: 422 });
  const tenant = await getTenant();
  const made = await createProject(req, {
    name, account_id: typeof body.account_id === "string" && body.account_id ? body.account_id : null, source_opportunity_id: null,
    contract_value: value, currency: cleanCurrency(body.currency) ?? resolveCurrency(tenant?.config).code,
    planned_start: cleanDate(body.planned_start), planned_end: cleanDate(body.planned_end),
    manager_id: typeof body.manager_id === "string" && body.manager_id ? body.manager_id : null, lines: [],
  });
  if (!made.ok) return NextResponse.json({ error: made.error, ...(made.extra ?? {}) }, { status: made.status });
  return NextResponse.json({ id: made.project.id, ref: made.project.ref, revision_id: made.revisionId }, { status: 201 });
}

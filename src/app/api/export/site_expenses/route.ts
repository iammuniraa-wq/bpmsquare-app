import { NextResponse, type NextRequest } from "next/server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { EXPENSE_COLS, canSeeExpense, loadViewerScope, normaliseExpense } from "@/lib/site/expensesServer";
import { failure, loadActorNames, openSiteRequest } from "@/lib/site/server";
import { ERP_STATE_LABEL, EXPENSE_STATUS_LABEL, PAID_BY_LABEL } from "@/lib/site/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Site expenses, one row per expense, with the real id (bpmsquarecore section 3). EXPORT ONLY: Import and Update are deliberately not offered, because a
// file would bypass the photo, the approval and the audit trail (corrections go through return, cancel and enter again). The rows are the ones this
// person may see: a cost approver or admin all of them, the project manager their project's, anyone else their own. Read with the service role and
// tenant-scoped, because the table's policy is select-only for author and admin.
export async function POST(request: NextRequest) {
  const gate = await openSiteRequest("site_expenses");
  if (!gate.ok) return failure(gate);
  const { admin, tenantId, supabase } = gate.req;
  const featureGate = await assertObjectFeature(tenantId, "site_expenses");
  if (featureGate) return featureGate;
  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };

  const scope = await loadViewerScope(gate.req);
  const [fieldConfig, salesConfig, all, projects, cats] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "site_expense"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Record<string, unknown>>(admin, "site_expenses", EXPENSE_COLS, tenantId),
    fetchAllRows<{ id: string; ref: string | null; name: string }>(admin, "contract_projects", "id, ref, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(admin, "site_expense_categories", "id, name", tenantId),
  ]);
  const visible = all.map(normaliseExpense).filter((e) => canSeeExpense(scope, e));
  const names = await loadActorNames(admin, tenantId, visible.flatMap((e) => [e.submitted_by, e.approved_by]));
  const spec = buildObjectSpec("site_expenses", fieldConfig, salesConfig);
  const projectName = new Map(projects.map((p) => [p.id, `${p.ref ? `${p.ref} ` : ""}${p.name}`]));
  const categoryName = new Map(cats.map((c) => [c.id, c.name]));

  const rows = visible.map((e) => {
    const values = rowToExportValues({ ...e, status: EXPENSE_STATUS_LABEL[e.status], paid_by: PAID_BY_LABEL[e.paid_by], erp_state: ERP_STATE_LABEL[e.erp_state] } as unknown as Record<string, unknown>, spec.fields);
    values.id = e.id;
    values.project_name = projectName.get(e.project_id) ?? "";
    values.category_name = e.category_id ? categoryName.get(e.category_id) ?? "" : "";
    values.submitted_by_name = names.get(e.submitted_by) ?? "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}

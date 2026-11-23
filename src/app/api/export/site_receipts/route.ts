import { NextResponse, type NextRequest } from "next/server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { RECEIPT_COLS, normaliseReceipt } from "@/lib/site/receiptsServer";
import { failure, loadActorNames, openSiteRequest } from "@/lib/site/server";
import { ERP_STATE_LABEL, RECEIPT_OUTCOME_LABEL, RECEIPT_STATUS_LABEL } from "@/lib/site/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Site receipt HEADERS, one row per receipt, with the real id (bpmsquare core section 3). EXPORT ONLY: a receipt is evidence with a count, photos and a
// signature, so Import and Update are deliberately not offered (a manager cancels a receipt with a reason and the site person enters it again). The items
// are not columns here. Read with the service role and tenant-scoped, because the table's policy is select-only for the receiver and admin.
export async function POST(request: NextRequest) {
  const gate = await openSiteRequest("site_receipts");
  if (!gate.ok) return failure(gate);
  const { admin, tenantId, supabase } = gate.req;
  const featureGate = await assertObjectFeature(tenantId, "site_receipts");
  if (featureGate) return featureGate;
  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, all, projects] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "site_receipt"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Record<string, unknown>>(admin, "site_receipts", RECEIPT_COLS, tenantId),
    fetchAllRows<{ id: string; ref: string | null; name: string }>(admin, "contract_projects", "id, ref, name", tenantId),
  ]);
  const receipts = all.map(normaliseReceipt);
  const names = await loadActorNames(admin, tenantId, receipts.map((r) => r.received_by));
  const spec = buildObjectSpec("site_receipts", fieldConfig, salesConfig);
  const projectName = new Map(projects.map((p) => [p.id, `${p.ref ? `${p.ref} ` : ""}${p.name}`]));

  const rows = receipts.map((r) => {
    const values = rowToExportValues({ ...r, status: RECEIPT_STATUS_LABEL[r.status], outcome: RECEIPT_OUTCOME_LABEL[r.outcome], erp_state: ERP_STATE_LABEL[r.erp_state] } as unknown as Record<string, unknown>, spec.fields);
    values.id = r.id;
    values.project_name = projectName.get(r.project_id) ?? "";
    values.received_by_name = names.get(r.received_by) ?? "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}

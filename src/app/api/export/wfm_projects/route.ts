import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

type Row = {
  id: string; ref: string | null; name: string; code: string | null; parent_id: string | null;
  account_id: string | null; status: string; start_date: string | null; end_date: string | null;
  budget_hours: number | null; custom_data: Record<string, unknown> | null;
};

// POST /api/export/wfm_projects -- Data Workbench export. Emits the real id
// (the only key an Update may match on, §3) plus the parent's Project ID and
// the account's name in the same columns the import reads, so an export
// round-trips.
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, projects, accounts] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "project"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Row>(supabase, "wfm_projects", "*", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("wfm_projects", fieldConfig, salesConfig);
  const refOf = new Map(projects.map((p) => [p.id, p.ref ?? ""]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));

  const rows = projects.map((raw) => {
    const values = rowToExportValues(raw as unknown as Record<string, unknown>, spec.fields);
    values.id = raw.id;
    values.parent_ref = raw.parent_id ? (refOf.get(raw.parent_id) ?? "") : "";
    values.account_name = raw.account_id ? (accountName.get(raw.account_id) ?? "") : "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}

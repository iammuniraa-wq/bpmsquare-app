import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// RFQ headers with their real id (bpmsquarecore §3) -- the file an Update
// must come from. Supplier prices are never exported here: they are the
// buyer's, and live on the RFQ screen and the explicitly-scoped v1 API.
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const gate = await assertObjectFeature(tenantId, "rfqs");
  if (gate) return gate;

  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };
  const [fieldConfig, salesConfig] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "rfq"),
    getSalesConfig(supabase, tenantId),
  ]);
  // fetchAllRows filters by tenant_id itself; the admin client is used only
  // because 0128 may still be pending, where the session read would error
  // the same way -- an empty list either way.
  const rows = await fetchAllRows<Record<string, unknown>>(createAdminSupabase(), "rfqs", "*", tenantId).catch(() => []);
  const spec = buildObjectSpec("rfqs", fieldConfig, salesConfig);
  const out = rows.map((raw) => {
    const values = rowToExportValues(raw, spec.fields);
    values.id = raw.id as string;
    return values;
  });
  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(out, filters, typeByKey) } satisfies ExportResponse);
}

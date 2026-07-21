import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { Supplier } from "@/lib/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, suppliers] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "supplier"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Supplier>(supabase, "suppliers", "*", tenantId),
  ]);
  const spec = buildObjectSpec("suppliers", fieldConfig, salesConfig);

  const rows = suppliers.map((raw) => {
    const values = rowToExportValues(raw, spec.fields);
    values.id = raw.id;
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}

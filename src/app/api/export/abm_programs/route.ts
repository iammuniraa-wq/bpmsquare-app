import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { AbmProgram } from "@/lib/abm/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const gate = await assertObjectFeature(tenantId, "abm_programs");
  if (gate) return gate;

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, programs] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "abm_program"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<AbmProgram>(supabase, "abm_programs", "*", tenantId),
  ]);
  const spec = buildObjectSpec("abm_programs", fieldConfig, salesConfig);

  const rows = programs.map((raw) => {
    const values = rowToExportValues(raw as unknown as Record<string, unknown>, spec.fields);
    values.id = raw.id;
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}

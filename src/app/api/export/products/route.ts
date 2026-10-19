import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { supplierColumnAvailable, withoutSupplierFields } from "@/lib/products/supplier";
import type { Product } from "@/lib/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "products");
  if (gate) return gate;

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, products, suppliers, supplierOn] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "product"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Product>(supabase, "products", "*", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "suppliers", "id, name", tenantId),
    supplierColumnAvailable(supabase),
  ]);
  const built = buildObjectSpec("products", fieldConfig, salesConfig);
  // 0132 pending: no Supplier / Supplier ID columns rather than empty ones.
  const spec = supplierOn ? built : withoutSupplierFields(built);
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));

  const rows = products.map((raw) => {
    const values = rowToExportValues(raw, spec.fields);
    values.id = raw.id;
    // The Item type column carries the KEY (stable across renames); Import also accepts the label.
    // Name for people, the real supplier id (a field of the registry) for
    // anything that must key off the record.
    if (supplierOn) values.supplier_name = raw.supplier_id ? supplierNameById.get(raw.supplier_id) ?? "" : "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}

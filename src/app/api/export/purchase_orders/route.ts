import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { PurchaseOrder } from "@/lib/types";
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

  const [fieldConfig, salesConfig, purchaseOrders, suppliers, quotes] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "purchase_order"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<PurchaseOrder>(supabase, "purchase_orders", "*", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "suppliers", "id, name", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "quotes", "id, ref", tenantId),
  ]);
  const spec = buildObjectSpec("purchase_orders", fieldConfig, salesConfig);
  const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));
  const quoteRefById = new Map(quotes.map((q) => [q.id, q.ref]));

  const rows = purchaseOrders.map((raw) => {
    const values = rowToExportValues(raw, spec.fields);
    values.id = raw.id;
    values.supplier_name = supplierNameById.get(raw.supplier_id) ?? "";
    values.quote_ref = raw.quote_id ? quoteRefById.get(raw.quote_id) ?? "" : "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}

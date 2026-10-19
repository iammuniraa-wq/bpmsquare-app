import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { applyFilters } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { PRODUCT_BOM_LINES_SPEC } from "@/lib/import/productBomLinesSchema";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

type LineRow = { id: string; parent_product_id: string; component_product_id: string; qty: number | string; uom: string | null; scrap_pct: number | string; line_kind: string; note: string | null; sort_order: number };

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
  const gate = await assertObjectFeature(tenantId, "product_bom_lines");
  if (gate) return gate;

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [lines, products] = await Promise.all([
    fetchAllRows<LineRow>(supabase, "product_bom_lines", "id, parent_product_id, component_product_id, qty, uom, scrap_pct, line_kind, note, sort_order", tenantId),
    fetchAllRows<{ id: string; ref: string | null; sku: string | null; name: string }>(supabase, "products", "id, ref, sku, name", tenantId),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  // The "BOM / kit" and "Component" columns carry the SKU (or the product ID when there is none),
  // so a file edited and imported elsewhere resolves; the real ids ride along for Update.
  const token = (id: string) => { const p = byId.get(id); return p ? p.sku || p.ref || "" : ""; };

  const rows: Record<string, string>[] = lines.map((l) => ({
    id: l.id,
    parent: token(l.parent_product_id),
    component: token(l.component_product_id),
    qty: String(l.qty),
    uom: l.uom ?? "",
    scrap_pct: String(l.scrap_pct),
    line_kind: l.line_kind,
    note: l.note ?? "",
    parent_product_id: l.parent_product_id,
    component_product_id: l.component_product_id,
    parent_sku: byId.get(l.parent_product_id)?.sku ?? "",
    component_sku: byId.get(l.component_product_id)?.sku ?? "",
    parent_name: byId.get(l.parent_product_id)?.name ?? "",
    component_name: byId.get(l.component_product_id)?.name ?? "",
  }));

  const typeByKey = new Map(PRODUCT_BOM_LINES_SPEC.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}

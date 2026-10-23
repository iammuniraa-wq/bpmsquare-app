import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { applyFilters } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { SALES_ORDER_LINES_SPEC } from "@/lib/import/salesOrderLinesSchema";
import type { SalesOrderLine } from "@/lib/salesOrders/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Every line of every sales order of the workspace, with its own real id (the Update key) and its order's Order ID.
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk either.
  const gate = await assertObjectFeature(tenantId, "sales_order_lines");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "sales_orders")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };

  const [lines, orders] = await Promise.all([
    fetchAllRows<SalesOrderLine>(supabase, "sales_order_lines", "*", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "sales_orders", "id, ref", tenantId),
  ]);
  const refById = new Map(orders.map((o) => [o.id, o.ref]));
  const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

  const rows: Record<string, string>[] = lines.map((l) => ({
    id: l.id,
    sales_order_ref: refById.get(l.order_id) ?? "",
    line_no: s(l.line_no),
    description: s(l.description),
    printed_text: s(l.printed_text),
    uom: s(l.uom),
    qty: s(l.qty),
    unit_price: s(l.unit_price),
    discount_pct: s(l.discount_pct),
    tax_pct: s(l.tax_pct),
    requested_date: s(l.requested_date),
    line_total: s(l.line_total),
    confirmed_qty: s(l.confirmed_qty),
    confirmed_date: s(l.confirmed_date),
    availability_source: s(l.availability_source),
  }));

  const typeByKey = new Map(SALES_ORDER_LINES_SPEC.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}

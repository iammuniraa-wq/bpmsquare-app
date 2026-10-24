import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Sales order HEADERS, one row per order, with the real id (bpmsquarecore section 3) -- the file an Update must come
// from, and where an order's Order ID is read off for the lines file. Lines are their own family
// (export/sales_order_lines). The creator, cancellation note and bill-to / ship-to parties are not in this object.
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk either.
  const gate = await assertObjectFeature(tenantId, "sales_orders");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "sales_orders")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, orders, accounts, contacts, types] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "sales_order"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Record<string, unknown>>(supabase, "sales_orders", "*", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "contacts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "sales_order_types", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("sales_orders", fieldConfig, salesConfig);
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const contactNameById = new Map(contacts.map((c) => [c.id, c.name]));
  const typeNameById = new Map(types.map((t) => [t.id, t.name]));

  const rows = orders.map((o) => {
    const values = rowToExportValues(o, spec.fields);
    values.id = o.id as string;
    values.account_name = accountNameById.get(o.account_id as string) ?? "";
    values.contact_name = o.contact_id ? contactNameById.get(o.contact_id as string) ?? "" : "";
    values.type_name = o.type_id ? typeNameById.get(o.type_id as string) ?? "" : "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}

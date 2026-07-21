import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { Invoice } from "@/lib/types";
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

  const [fieldConfig, salesConfig, invoices, accounts, contacts, quotes, workOrders] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "invoice"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Invoice>(supabase, "invoices", "*", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "contacts", "id, name", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "quotes", "id, ref", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "work_orders", "id, ref", tenantId),
  ]);
  const spec = buildObjectSpec("invoices", fieldConfig, salesConfig);
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const contactNameById = new Map(contacts.map((c) => [c.id, c.name]));
  const quoteRefById = new Map(quotes.map((q) => [q.id, q.ref]));
  const workOrderRefById = new Map(workOrders.map((w) => [w.id, w.ref]));

  const rows = invoices.map((raw) => {
    const values = rowToExportValues(raw, spec.fields);
    values.id = raw.id;
    values.account_name = accountNameById.get(raw.account_id) ?? "";
    values.contact_name = raw.contact_id ? contactNameById.get(raw.contact_id) ?? "" : "";
    values.quote_ref = raw.quote_id ? quoteRefById.get(raw.quote_id) ?? "" : "";
    values.work_order_ref = raw.work_order_id ? workOrderRefById.get(raw.work_order_id) ?? "" : "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}

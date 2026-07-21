import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { WorkOrder } from "@/lib/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

type RawWorkOrder = WorkOrder & { auth_kind: "quote" | "contract"; auth_id: string };

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, workOrders, accounts, cases, assets, quotes] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "work_order"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<RawWorkOrder>(supabase, "work_orders", "*", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "service_cases", "id, ref", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "assets", "id, name", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "quotes", "id, ref", tenantId),
  ]);
  const spec = buildObjectSpec("work_orders", fieldConfig, salesConfig);
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const caseRefById = new Map(cases.map((c) => [c.id, c.ref]));
  const assetNameById = new Map(assets.map((a) => [a.id, a.name]));
  const quoteRefById = new Map(quotes.map((q) => [q.id, q.ref]));

  const rows = workOrders.map((raw) => {
    const values = rowToExportValues(raw, spec.fields);
    values.id = raw.id;
    values.account_name = accountNameById.get(raw.account_id) ?? "";
    values.case_ref = raw.case_id ? caseRefById.get(raw.case_id) ?? "" : "";
    values.asset_name = raw.asset_id ? assetNameById.get(raw.asset_id) ?? "" : "";
    values.quote_ref = raw.auth_kind === "quote" ? quoteRefById.get(raw.auth_id) ?? "" : "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}

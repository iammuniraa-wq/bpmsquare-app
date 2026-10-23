import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Standard quote HEADERS, one row per quote, with the real id (bpmsquarecore section 3) -- the
// file an Update must come from, and where a quote's Quote ID is read off for the lines file.
// Lines are their own family (export/standard_quote_lines). No pricing flags or other line
// state is in this object at all.
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "standard_quotes");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "standard_quotes")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, quotes, accounts, contacts] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "standard_quote"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Record<string, unknown>>(supabase, "standard_quotes", "*", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "contacts", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("standard_quotes", fieldConfig, salesConfig);
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const contactNameById = new Map(contacts.map((c) => [c.id, c.name]));

  const rows = quotes.map((q) => {
    const values = rowToExportValues(q, spec.fields);
    values.id = q.id as string;
    values.account_name = accountNameById.get(q.account_id as string) ?? "";
    values.contact_name = q.contact_id ? contactNameById.get(q.contact_id as string) ?? "" : "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}

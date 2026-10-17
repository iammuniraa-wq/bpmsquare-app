import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canViewWorkcenter } from "@/lib/permissions";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Estimate HEADERS with their real id (bpmsquarecore section 3) -- the file an Update must
// come from. Lines, unit costs and totals are never exported here: they are internal cost
// data and live on the estimate screen and its BOM/WBS export.
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const gate = await assertObjectFeature(tenantId, "estimates");
  if (gate) return gate;
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canViewWorkcenter(perms, "estimates")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { filters = [] } = (await request.json().catch(() => ({}))) as { filters?: ExportFilter[] };
  const [fieldConfig, salesConfig, estimates, accounts, contacts, templates] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "estimate"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Record<string, unknown>>(supabase, "estimates", "id, ref, name, status, account_id, contact_id, template_id, currency, margin_pct, notes, custom_data", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "contacts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "estimate_templates", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("estimates", fieldConfig, salesConfig);
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const contactName = new Map(contacts.map((c) => [c.id, c.name]));
  const templateName = new Map(templates.map((t) => [t.id, t.name]));

  const out = estimates.map((raw) => {
    const values = rowToExportValues(raw, spec.fields);
    values.id = raw.id as string;
    values.account_name = accountName.get(raw.account_id as string) ?? "";
    values.contact_name = contactName.get(raw.contact_id as string) ?? "";
    values.template_name = templateName.get(raw.template_id as string) ?? "";
    return values;
  });
  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(out, filters, typeByKey) } satisfies ExportResponse);
}

import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { AbmTargetAccount } from "@/lib/abm/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Target accounts: the real id, the program ref and the account name (so the file reads), and the
// plain columns. No contact data: people are the separate "ABM buying groups" object.
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const gate = await assertObjectFeature(tenantId, "abm_targets");
  if (gate) return gate;

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, targets, programs, accounts] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "abm_target"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<AbmTargetAccount>(supabase, "abm_target_accounts", "*", tenantId),
    fetchAllRows<{ id: string; ref: string | null }>(supabase, "abm_programs", "id, ref", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("abm_targets", fieldConfig, salesConfig);
  const refOf = new Map(programs.map((p) => [p.id, p.ref ?? ""]));
  const nameOf = new Map(accounts.map((a) => [a.id, a.name]));

  const rows = targets.map((raw) => {
    const values = rowToExportValues(raw as unknown as Record<string, unknown>, spec.fields);
    values.id = raw.id;
    values.program_ref = refOf.get(raw.program_id) ?? "";
    values.account_name = nameOf.get(raw.account_id) ?? "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}

import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { decryptAccount } from "@/lib/encryption";
import type { Account } from "@/lib/types";
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

  const [fieldConfig, salesConfig, accounts] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "account"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Account>(supabase, "accounts", "*", tenantId),
  ]);
  const spec = buildObjectSpec("accounts", fieldConfig, salesConfig);
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));

  const rows = accounts.map((raw) => {
    const decrypted = decryptAccount(raw);
    const values = rowToExportValues(decrypted, spec.fields);
    values.id = decrypted.id;
    values.referred_by_account_name = decrypted.referred_by_account_id
      ? nameById.get(decrypted.referred_by_account_id) ?? ""
      : "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}

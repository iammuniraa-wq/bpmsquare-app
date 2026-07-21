import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import { decryptContact } from "@/lib/encryption";
import type { Contact } from "@/lib/types";
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

  const [fieldConfig, salesConfig, contacts, accounts] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "contact"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<Contact>(supabase, "contacts", "*", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("contacts", fieldConfig, salesConfig);
  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));

  const rows = contacts.map((raw) => {
    const decrypted = decryptContact(raw);
    const values = rowToExportValues(decrypted, spec.fields);
    values.id = decrypted.id;
    values.account_name = accountNameById.get(decrypted.account_id) ?? "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  const filtered = applyFilters(rows, filters, typeByKey);

  return NextResponse.json({ rows: filtered } satisfies ExportResponse);
}

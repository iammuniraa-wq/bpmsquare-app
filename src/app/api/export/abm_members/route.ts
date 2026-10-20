import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { applyFilters, rowToExportValues } from "@/lib/import/exportServer";
import { fetchAllRows } from "@/lib/import/server";
import type { AbmBuyingGroupMember, AbmTargetAccount } from "@/lib/abm/types";
import type { ExportFilter, ExportResponse } from "@/lib/import/types";

// Buying group members: id, program ref, account name, the person's NAME and the role. The private
// note (`notes`) and every contact detail (email, phone) are left out on purpose.
export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const gate = await assertObjectFeature(tenantId, "abm_members");
  if (gate) return gate;

  const { filters = [] } = (await request.json()) as { filters?: ExportFilter[] };

  const [fieldConfig, salesConfig, members, targets, programs, accounts, contacts] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "abm_member"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<AbmBuyingGroupMember>(supabase, "abm_buying_group_members", "id, target_account_id, contact_id, role, custom_data", tenantId),
    fetchAllRows<Pick<AbmTargetAccount, "id" | "program_id" | "account_id">>(supabase, "abm_target_accounts", "id, program_id, account_id", tenantId),
    fetchAllRows<{ id: string; ref: string | null }>(supabase, "abm_programs", "id, ref", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "accounts", "id, name", tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "contacts", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("abm_members", fieldConfig, salesConfig);
  const targetOf = new Map(targets.map((t) => [t.id, t]));
  const refOf = new Map(programs.map((p) => [p.id, p.ref ?? ""]));
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const contactName = new Map(contacts.map((x) => [x.id, x.name]));

  const rows = members.map((raw) => {
    const values = rowToExportValues(raw as unknown as Record<string, unknown>, spec.fields);
    const t = targetOf.get(raw.target_account_id);
    values.id = raw.id;
    values.program_ref = t ? refOf.get(t.program_id) ?? "" : "";
    values.account_name = t ? accountName.get(t.account_id) ?? "" : "";
    values.contact_name = contactName.get(raw.contact_id) ?? "";
    return values;
  });

  const typeByKey = new Map(spec.fields.map((f) => [f.key, f.type]));
  return NextResponse.json({ rows: applyFilters(rows, filters, typeByKey) } satisfies ExportResponse);
}

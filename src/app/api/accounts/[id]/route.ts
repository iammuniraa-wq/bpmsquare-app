import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { encrypt, decrypt, decryptAccount } from "@/lib/encryption";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { id } = await params;

  const { data: snap } = await supabase
    .from("accounts")
    .select("name, type, city, created_at")
    .eq("id", id).eq("tenant_id", tenantId).single();

  const { error } = await supabase.from("accounts").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (snap) {
    const admin = createAdminSupabase();
    const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).single();
    const cfg = (tenant?.config ?? {}) as Record<string, unknown>;
    const log = Array.isArray(cfg.deleted_accounts) ? (cfg.deleted_accounts as unknown[]) : [];
    log.push({ id, name: snap.name, status: snap.type, account_id: null, created_at: snap.created_at, deleted_at: new Date().toISOString(), deleted_by: userId });
    await admin.from("tenants").update({ config: { ...cfg, deleted_accounts: log } }).eq("id", tenantId);
  }
  return new NextResponse(null, { status: 204 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();

  const allowed = [
    "name", "type",
    "address_line1", "address_line2", "city", "state", "postal_code", "country",
    "phone", "phone2", "email", "email2", "website",
    "industry", "employee_count", "annual_revenue", "gstin", "notes",
    "territory", "sales_org",
    "referred_by_account_id", "custom_data",
  ];
  const PII_FIELDS = new Set(["phone", "phone2", "email", "email2", "gstin"]);
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = PII_FIELDS.has(key) ? encrypt(body[key] as string | null) : body[key];
  }

  const { data, error } = await supabase
    .from("accounts")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(decryptAccount(data as import("@/lib/types").Account));
}

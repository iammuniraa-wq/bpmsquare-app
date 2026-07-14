import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { isPlatformAdmin } from "@/lib/tenant";

export async function GET(_request: NextRequest) {
  let tenantId;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const admin = createAdminSupabase();
  const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  const cfg = (tenant?.config ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    deleted_quotes:      Array.isArray(cfg.deleted_quotes)      ? cfg.deleted_quotes      : [],
    deleted_cases:       Array.isArray(cfg.deleted_cases)       ? cfg.deleted_cases       : [],
    deleted_work_orders: Array.isArray(cfg.deleted_work_orders) ? cfg.deleted_work_orders : [],
    deleted_accounts:    Array.isArray(cfg.deleted_accounts)    ? cfg.deleted_accounts    : [],
  });
}

// Only platform admins can clear the log
export async function DELETE(_request: NextRequest) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Platform admin only" }, { status: 403 });

  let tenantId;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const admin = createAdminSupabase();
  const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  const cfg = (tenant?.config ?? {}) as Record<string, unknown>;

  await admin.from("tenants").update({
    config: {
      ...cfg,
      deleted_quotes: [],
      deleted_cases: [],
      deleted_work_orders: [],
      deleted_accounts: [],
    },
  }).eq("id", tenantId);

  return new NextResponse(null, { status: 204 });
}

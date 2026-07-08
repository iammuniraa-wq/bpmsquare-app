import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig } from "@/lib/constants";

export async function GET() {
  let tenantId;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("tenants")
    .select("config")
    .eq("id", tenantId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data?.config as TenantConfig) ?? { entities: [], tax: { label: "GST", rate: 18, inclusive: false } });
}

export async function PATCH(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body: Partial<TenantConfig> = await request.json();

  const admin = createAdminSupabase();

  // Merge patch — read current config first so we don't overwrite unrelated keys
  const { data: current, error: readErr } = await admin
    .from("tenants")
    .select("config")
    .eq("id", tenantId)
    .single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const merged = { ...(current?.config ?? {}), ...body };

  const { error } = await admin
    .from("tenants")
    .update({ config: merged })
    .eq("id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(merged);
}

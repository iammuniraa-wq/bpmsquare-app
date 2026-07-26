import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import type { TenantConfig } from "@/lib/constants";

export async function GET() {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await createAdminSupabase()
    .from("tenants")
    .select("config")
    .eq("id", tenantId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data?.config as TenantConfig | null)?.integration_push ?? {});
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

  const body: { webhook_url?: string; regenerate_secret?: boolean } = await request.json();

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin
    .from("tenants")
    .select("config")
    .eq("id", tenantId)
    .single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const currentConfig = (current?.config ?? {}) as TenantConfig;
  const currentPush = currentConfig.integration_push ?? {};
  const merged = {
    ...currentPush,
    ...(body.webhook_url !== undefined ? { webhook_url: body.webhook_url || undefined } : {}),
    ...(body.regenerate_secret ? { webhook_secret: randomBytes(24).toString("hex") } : {}),
  };

  const { error } = await admin
    .from("tenants")
    .update({ config: { ...currentConfig, integration_push: merged } })
    .eq("id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(merged);
}

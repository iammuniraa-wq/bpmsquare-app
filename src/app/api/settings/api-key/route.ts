import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

// Self-service regeneration of a tenant's own v1 API key (Settings -> General
// -> Developer section) -- previously only a platform admin could set this,
// via the internal /admin panel, even though the v1 auth error message has
// always told tenants to "generate one in Settings -> Admin -> this tenant."
export async function POST() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const apiKey = randomBytes(24).toString("hex");
  const { error } = await createAdminSupabase()
    .from("tenants")
    .update({ api_key: apiKey })
    .eq("id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ api_key: apiKey });
}

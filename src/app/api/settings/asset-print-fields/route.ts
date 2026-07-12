import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

export async function PUT(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const fields: string[] = await request.json();
  if (!Array.isArray(fields))
    return NextResponse.json({ error: "Expected array" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin
    .from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const merged = { ...(current?.config ?? {}), asset_print_fields: fields };
  const { error } = await admin.from("tenants").update({ config: merged }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

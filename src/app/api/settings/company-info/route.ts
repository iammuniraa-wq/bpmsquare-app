import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import type { CompanyInfo } from "@/lib/tenant";

export async function GET() {
  let tenantId;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data, error } = await createAdminSupabase()
    .from("tenants")
    .select("company_info")
    .eq("id", tenantId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data?.company_info as CompanyInfo) ?? {});
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

  const body: Partial<CompanyInfo> = await request.json();

  const admin = createAdminSupabase();
  const { data: current, error: readErr } = await admin
    .from("tenants")
    .select("company_info")
    .eq("id", tenantId)
    .single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const merged: CompanyInfo = { ...(current?.company_info ?? {}), ...body };

  const { error } = await admin
    .from("tenants")
    .update({ company_info: merged })
    .eq("id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(merged);
}

import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
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

  const previous = (current?.company_info ?? {}) as CompanyInfo;
  const merged: CompanyInfo = { ...previous, ...body };

  // One logo for the workspace: the app sidebar, sign-in page and prints read tenants.logo_url, the letterhead reads
  // company_info.logo_url. Sync only when this save actually changed the logo, so a save of other company details never
  // overwrites a sidebar logo a platform admin set separately.
  const patch: { company_info: CompanyInfo; logo_url?: string | null } = { company_info: merged };
  if (typeof body.logo_url === "string" && body.logo_url !== (previous.logo_url ?? "")) patch.logo_url = body.logo_url || null;

  const { error } = await admin
    .from("tenants")
    .update(patch)
    .eq("id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The pre-auth sign-in page reads the logo through a 5-minute branding cache; clear it so the new logo shows at once.
  if (patch.logo_url !== undefined) revalidateTag("tenant-branding", { expire: 0 });
  return NextResponse.json(merged);
}

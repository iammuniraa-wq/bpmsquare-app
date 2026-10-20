import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { storeCompanyImage } from "@/lib/companyAssetUpload";

export async function POST(request: NextRequest) {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await request.formData();
  const file = form.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const stored = await storeCompanyImage(createAdminSupabase(), tenantId, file);
  if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: stored.status });
  return NextResponse.json({ url: stored.url }, { status: 201 });
}

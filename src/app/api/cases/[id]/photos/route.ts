import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const { data, error } = await supabase
    .from("case_photos")
    .select("*")
    .eq("case_id", id)
    .eq("tenant_id", tenantId)
    .order("taken_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let tenantId, userId;
  try {
    ({ tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id: caseId } = await params;

  const formData = await request.formData();
  const file     = formData.get("file") as File | null;
  const stage    = (formData.get("stage") as string) || "intake";
  const caption  = (formData.get("caption") as string) || "";

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (!validTypes.includes(file.type) && !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are allowed" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Verify case belongs to this tenant
  const { data: sc } = await admin
    .from("service_cases")
    .select("id")
    .eq("id", caseId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!sc) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  // Build storage path: tenantId/caseId/timestamp-filename
  const ext      = file.name.split(".").pop() ?? "jpg";
  const safeName = `${Date.now()}-${userId.slice(0, 8)}.${ext}`;
  const path     = `${tenantId}/${caseId}/${safeName}`;

  const bytes  = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const { error: uploadError } = await admin.storage
    .from("case-photos")
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

  const { data: { publicUrl } } = admin.storage.from("case-photos").getPublicUrl(path);

  const { data: photo, error: dbError } = await admin
    .from("case_photos")
    .insert({
      case_id:   caseId,
      tenant_id: tenantId,
      stage,
      url:       publicUrl,
      caption,
      taken_at:  new Date().toISOString(),
    })
    .select("*")
    .single();

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });
  return NextResponse.json(photo, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let tenantId;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id: caseId } = await params;
  const { photoId } = await request.json();

  const admin = createAdminSupabase();

  const { data: photo } = await admin
    .from("case_photos")
    .select("url")
    .eq("id", photoId)
    .eq("case_id", caseId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  // Extract storage path from public URL
  const url   = new URL(photo.url);
  const parts = url.pathname.split("/case-photos/");
  if (parts[1]) {
    await admin.storage.from("case-photos").remove([parts[1]]);
  }

  await admin.from("case_photos").delete().eq("id", photoId).eq("tenant_id", tenantId);

  return NextResponse.json({ ok: true });
}

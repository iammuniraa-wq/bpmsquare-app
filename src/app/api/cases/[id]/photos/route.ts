import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { logChange } from "@/lib/changeLog";

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
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
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

  // Strict allowlist, no "starts with image/" fallback -- that fallback let
  // image/svg+xml through, and an SVG can carry a <script>/onload payload
  // that executes when its public storage URL is opened directly (stored XSS).
  // Case photos are always raster; there's no legitimate reason to accept SVG here.
  const validTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  if (!validTypes.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, WebP, HEIC, or HEIF images are allowed" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Verify case belongs to this tenant
  const { data: sc } = await admin
    .from("service_cases")
    .select("id, ref")
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

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "cases", objectId: caseId, objectLabel: sc.ref,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Photo added", from: null, to: `${stage}${caption ? `: ${caption}` : ""}` }],
  });

  return NextResponse.json(photo, { status: 201 });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id: caseId } = await params;
  const { photoId } = await request.json();

  const admin = createAdminSupabase();

  const { data: photo } = await admin
    .from("case_photos")
    .select("url, stage, caption")
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

  const { data: sc } = await admin.from("service_cases").select("ref").eq("id", caseId).eq("tenant_id", tenantId).maybeSingle();
  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "cases", objectId: caseId, objectLabel: sc?.ref ?? null,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "Photo removed", from: `${photo.stage}${photo.caption ? `: ${photo.caption}` : ""}`, to: null }],
  });

  return NextResponse.json({ ok: true });
}

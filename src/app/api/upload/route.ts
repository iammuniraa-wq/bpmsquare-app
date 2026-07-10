import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

const BUCKET = "company-assets";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"];

export async function POST(request: NextRequest) {
  let tenantId: string;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const form = await request.formData();
  const file = form.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: `File type not allowed. Use: PNG, JPG, WebP, or SVG` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large — max 2 MB" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const adminSupa = createAdminSupabase();
  const { error } = await adminSupa.storage
    .from(BUCKET)
    .upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: { publicUrl } } = adminSupa.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: publicUrl }, { status: 201 });
}

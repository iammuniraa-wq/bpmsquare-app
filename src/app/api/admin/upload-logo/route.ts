import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { isPlatformAdmin } from "@/lib/tenant";

export async function POST(request: NextRequest) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const allowed = ["png", "jpg", "jpeg", "svg", "webp"];
  if (!allowed.includes(ext)) {
    return NextResponse.json({ error: "Only PNG, JPG, SVG, WEBP allowed" }, { status: 400 });
  }

  const path = `partner-logos/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const bytes = await file.arrayBuffer();

  const admin = createAdminSupabase();
  const { error: upErr } = await admin.storage
    .from("logos")
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { data: { publicUrl } } = admin.storage.from("logos").getPublicUrl(path);

  return NextResponse.json({ url: publicUrl });
}

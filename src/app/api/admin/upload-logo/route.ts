import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { isPlatformAdmin } from "@/lib/tenant";

export async function POST(request: NextRequest) {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  // Validate the actual MIME type, not the client-supplied filename extension
  // -- the previous extension-only check let a request send an allowed-looking
  // filename ("x.png") while a different file.type (e.g. "image/svg+xml") was
  // still stored as-is via `contentType: file.type` below, so the object would
  // still be served as SVG regardless of its ".png"-looking path. No SVG: it's
  // XML and can carry a <script>/onload payload that executes when its public
  // storage URL is opened directly -- stored XSS. Partner logos render fine as
  // raster. The extension used in the storage path is derived from the
  // validated MIME type, never from the attacker-supplied filename.
  const EXT_BY_TYPE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) {
    return NextResponse.json({ error: "Only PNG, JPG, WEBP allowed" }, { status: 400 });
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

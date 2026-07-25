import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

const BUCKET = "company-assets";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
// No SVG: it's XML and can carry a <script>/onload payload that executes when
// its public storage URL is opened directly -- stored XSS on a trusted-looking
// domain. Logos/certs render fine as raster.
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
// Extension in the storage path is derived from the validated MIME type below,
// never from the attacker-supplied filename -- otherwise a request could send
// an allowed-looking filename while `contentType: file.type` (used verbatim
// below) still stores/serves a different, unvalidated content type.
const EXT_BY_TYPE: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp" };

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
  if (!ALLOWED.includes(file.type)) {
    return NextResponse.json({ error: `File type not allowed. Use: PNG, JPG, or WebP` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large — max 2 MB" }, { status: 400 });
  }

  const ext = EXT_BY_TYPE[file.type];
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
